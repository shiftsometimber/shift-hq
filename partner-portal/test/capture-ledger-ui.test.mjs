import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {functionalClient,FUNCTIONAL_CSS} from '../platform/functional-ui.mjs';
test('Owner capture-link form survives a lost response without another payment and retains its saved result after reload',async()=>{
 for(const type of [chromium,webkit]){
 const browser=await type.launch({headless:true});try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});let linked=false,posts=0;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),root='/api/clinical/platform';
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+FUNCTIONAL_CSS+'</style></head><body class="rx-app" data-functional="true"><main class="rx-content"><section id="rx-finance"><div id="rx-finance-content"></div></section><p id="rx-notice" role="alert"></p></main></body>'});
  if(u.pathname===root+'/refunds')return route.fulfill({json:{refunds:[],fullCommercial:true,captureWork:{state:'available',records:linked?[]:[{orderReference:'SST-TEST-CAPTURE',amountPence:16900,state:'ready'},{orderReference:'SST-TEST-NEEDS-TERMS',amountPence:16900,state:'terms_required'}]}}});
  if(u.pathname===root+'/finance-exceptions')return route.fulfill({json:{exceptions:[],owners:[],matchedStatements:[]}});
  if(u.pathname===root)return route.fulfill({json:{qaProviderManagementAvailable:false}});
  if(u.pathname===root+'/commercial/SST-TEST-CAPTURE/capture'&&req.method()==='POST'){
   assert.deepEqual(req.postDataJSON(),{});posts++;const duplicate=linked;linked=true;if(posts===1)return route.fulfill({status:503,json:{error:'TEST_lost_response_after_ledger_saved'}});return route.fulfill({json:{state:'recorded',duplicate,moneyMoved:false}});
  }
  throw Error('Unapproved request '+req.method()+' '+u.pathname);
 });
 const load=async()=>{await page.goto('https://rx-qa.sstrx.co.uk/finance');await page.addScriptTag({content:'('+functionalClient.toString()+')();'});await page.getByText('Original payments awaiting a ledger link',{exact:true}).waitFor();};
 await load();await page.getByText('Original payments awaiting a ledger link',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Record verified original payment',exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const button=page.getByRole('button',{name:'Record verified original payment',exact:true});await button.click();await page.getByText('TEST lost response after ledger saved',{exact:true}).waitFor();await button.click();await page.getByText('The existing verified payment is linked to the ledger. No new payment was taken.',{exact:true}).waitFor();assert.equal(posts,2);
 await load();assert.equal(await page.getByRole('button',{name:'Record verified original payment',exact:true}).count(),0);assert.equal(posts,2);await page.close();
 }
 }finally{await browser.close()}
 }
});
