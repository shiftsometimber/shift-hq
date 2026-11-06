import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {allowedPath} from '../policy.mjs';
import {functionalClient} from '../platform/functional-ui.mjs';
const base='https://rx-qa.sstrx.co.uk';
test('Native Finance form checks a known provider receipt with a freshly read version and never re-submits the refund',async()=>{
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   for(const state of ['submitted','unknown','requires_action']){
    const page=await browser.newPage({viewport:{width:390,height:844}});
    let completed=false;const calls=[];
    const refund={id:'TEST-held-refund',orderReference:'SST-TEST-HELD',state,version:4,amountPence:100,currency:'GBP',processorReference:'re_test_QA_known'};
    await page.route('**/*',async route=>{
     const req=route.request(),u=new URL(req.url());calls.push({path:u.pathname,method:req.method(),body:req.postDataJSON()});
     if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<body data-functional="true"><section id="rx-finance"><div id="rx-finance-content"></div></section><p id="rx-notice" role="alert"></p></body>'});
     if(u.pathname==='/api/clinical/platform/refunds'&&req.method()==='GET')return route.fulfill({json:{refunds:[{...refund,...completed?{state:'completed',version:8}:{}}],approvalLimitPence:1000,fullCommercial:false,canReconcileKnownReceipt:true,paymentSources:[]}});
     if(u.pathname==='/api/clinical/platform/finance-exceptions')return route.fulfill({json:{exceptions:[],owners:[],matchedStatements:[]}});
     if(u.pathname==='/api/clinical/platform/refunds/'+refund.id&&req.method()==='GET')return route.fulfill({json:{...refund,version:7}});
     if(u.pathname==='/api/clinical/platform/refunds/'+refund.id+'/reconcile'&&req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{version:7});completed=true;return route.fulfill({json:{...refund,state:'completed',version:8,reconciled:true}});}
     throw Error('Unapproved request in '+engine+': '+req.method()+' '+u.pathname);
    });
    await page.goto(base+'/finance');
    await page.addScriptTag({content:'('+functionalClient.toString()+')();'});
    const button=page.getByRole('button',{name:'Check provider receipt',exact:true});
    await button.waitFor();
    assert.equal(await page.getByRole('button',{name:'Submit refund',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Retry with the original refund key',exact:true}).count(),0);
    await button.evaluate(b=>{b.click();b.click();});
    await page.getByText('Payment provider completion confirmed.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/reconcile')).length,1);
    assert.equal(calls.filter(c=>c.path.endsWith('/submit')).length,0);
    assert.equal(await page.getByRole('button',{name:'Check provider receipt',exact:true}).count(),0);
    await page.close();
   }
   for(const variant of ['no-permission','over-limit','completed','unknown-without-reference']){
    const page=await browser.newPage();
    const refund={id:'TEST-held-refund',orderReference:'SST-TEST',state:variant==='completed'?'completed':variant==='unknown-without-reference'?'unknown':'submitted',version:4,amountPence:100,currency:'GBP',processorReference:variant==='unknown-without-reference'?null:'re_test_QA_known'};
    await page.route('**/*',async route=>{
     const req=route.request(),u=new URL(req.url());
     if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<body data-functional="true"><section id="rx-finance"><div id="rx-finance-content"></div></section><p id="rx-notice"></p></body>'});
     if(u.pathname==='/api/clinical/platform/refunds')return route.fulfill({json:{refunds:[refund],approvalLimitPence:variant==='over-limit'?50:1000,fullCommercial:false,canReconcileKnownReceipt:variant!=='no-permission',paymentSources:[]}});
     if(u.pathname==='/api/clinical/platform/finance-exceptions')return route.fulfill({json:{exceptions:[],owners:[],matchedStatements:[]}});
     throw Error('Unapproved request');
    });
    await page.goto(base+'/finance');await page.addScriptTag({content:'('+functionalClient.toString()+')();'});
    await page.getByText(refund.orderReference+' · '+refund.state,{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Check provider receipt',exact:true}).count(),0);
    if(variant==='unknown-without-reference'){
     assert.equal(await page.getByRole('button',{name:'Retry with the original refund key',exact:true}).count(),1);
     assert.equal(await page.getByText('Provider outcome is unknown. This retry uses the existing refund key.',{exact:true}).count(),1);
    }
    await page.close();
   }
  }finally{await browser.close();}
 }
});

test('Native portal admits only the exact oversight POST receipt-check route',()=>{
 const path='/api/clinical/platform/refunds/10df1827-cc29-4d6c-a94d-ab7649ff50ff/reconcile';
 assert.equal(allowedPath(path,'POST','oversight'),true);
 for(const kind of ['clinician','dispensing','clinical_admin','pharmacy_admin','support'])assert.equal(allowedPath(path,'POST',kind),false);
 for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal(allowedPath(path,method,'oversight'),false);
 for(const changed of [path+'/extra',path.replace('/reconcile','/reset'),path.replace('10df1827-cc29-4d6c-a94d-ab7649ff50ff','not-an-id')])assert.equal(allowedPath(changed,'POST','oversight'),false);
});
