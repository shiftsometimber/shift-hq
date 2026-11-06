import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {functionalClient,FUNCTIONAL_CSS} from '../platform/functional-ui.mjs';
test('Statement form retains one period/reference across a lost response and shows the saved result after reload',async()=>{
 for(const type of [chromium,webkit]){
 const browser=await type.launch({headless:true});try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}}),commands=[];let saved=null;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),root='/api/clinical/platform';
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+FUNCTIONAL_CSS+'</style></head><body class="rx-app" data-functional="true"><main class="rx-content"><section id="rx-finance"><div id="rx-finance-content"></div></section><p id="rx-notice" role="alert"></p></main></body>'});
  if(u.pathname===root+'/refunds')return route.fulfill({json:{refunds:[],fullCommercial:true,statementTransportAvailable:true,statementMode:'synthetic'}});
  if(u.pathname===root+'/finance-exceptions')return route.fulfill({json:{exceptions:[],owners:[{id:1,name:'TEST Finance owner'}],matchedStatements:[]}});
  if(u.pathname===root)return route.fulfill({json:{qaProviderManagementAvailable:false}});
  if(u.pathname===root+'/reconciliation'&&req.method()==='GET')return route.fulfill({json:{runs:saved?[saved]:[]}});
  if(u.pathname===root+'/reconciliation'&&req.method()==='POST'){
   const body=req.postDataJSON();commands.push(body);
   assert.equal(body.orderReference,'ALL');assert.equal(body.ownerUserId,1);assert.equal(body.fromAt,'2026-11-01T00:00:00.000Z');assert.equal(body.toAt,'2026-11-02T00:00:00.000Z');assert.match(body.sourceReference,/^TEST-QA-STMT-[a-f0-9-]{36}-\d{13}-\d{13}$/);
   saved={id:'TEST-saved-run',from_at:body.fromAt,to_at:body.toAt,source_reference:body.sourceReference,state:'matched',variance_pence:0};
   if(commands.length===1)return route.fulfill({status:503,json:{error:'TEST_lost_response_after_saved_run'}});
   assert.deepEqual(body,commands[0]);return route.fulfill({json:{id:saved.id,state:'matched',variancePence:0,duplicate:true}});
  }
  throw Error('Unexpected finance request '+req.method()+' '+u.pathname);
 });
 const load=async()=>{await page.goto('https://rx-qa.sstrx.co.uk/finance');await page.addScriptTag({content:'('+functionalClient.toString()+')();'});await page.getByText('Reconcile a provider statement',{exact:true}).waitFor();};
 await load();await page.getByText('Reconcile a provider statement',{exact:true}).click();
 await page.getByLabel('Statement period starts (UK time)',{exact:true}).fill('2026-11-01T00:00');await page.getByLabel('Statement period ends (UK time)',{exact:true}).fill('2026-11-02T00:00');await page.getByLabel('Variance response due (UK time)',{exact:true}).fill(new Date(Date.now()+3600000).toISOString().slice(0,16));assert.equal(await page.getByLabel('Statement source',{exact:true}).inputValue(),'Fictional provider statement');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const button=page.getByRole('button',{name:'Reconcile provider statement',exact:true});await button.click();await page.getByText('TEST lost response after saved run',{exact:true}).waitFor();await button.click();await page.getByText('The statement matches the saved finance entries for this period.',{exact:true}).waitFor();assert.equal(commands.length,2);
 await load();await page.getByText('Reconcile a provider statement',{exact:true}).click();await page.getByText('2026-11-01 to 2026-11-02 · matched · Variance £0.00',{exact:true}).waitFor();assert.equal(commands.length,2);await page.close();
 }
 }finally{await browser.close()}
 }
});
