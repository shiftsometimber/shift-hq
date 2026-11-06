// Actual finance client + native SQLite API; all browser transport is isolated.
// These checks do not qualify real cookies, WAN latency or physical devices.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {fixture,ORDER} from '../test/fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureFunctionalSchema} from '../platform/functional-casework.mjs';
import {ensureLifecycleSchema} from '../platform/prescription-lifecycle.mjs';
import {ensureFinanceOperations} from '../platform/finance-operations.mjs';
import {FUNCTIONAL_CLIENT,FUNCTIONAL_CSS} from '../platform/functional-ui.mjs';
const output=process.env.FINANCE_OPERATIONS_EVIDENCE||'.partner-qa/finance-operations';
await fs.mkdir(output,{recursive:true});
const report={sourceCommit:process.env.SSTRX_TESTED_SOURCE||'UNCOMMITTED',scope:'SYNTHETIC_UI_AND_NATIVE_SQLITE_API_ONLY',engines:[]};
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic'});
 await ensurePlatformSchema(f.DB);await ensureFunctionalSchema(f.DB);await ensureLifecycleSchema(f.DB);await ensureFinanceOperations(f.DB);
 const created=new Date().toISOString(),due=new Date(Date.now()+3600000).toISOString(),errors=[],requests=[],checks=[];
 f.sql.prepare("UPDATE medicine_orders SET stripe_payment_intent_id='pi_FICTIONAL_FINANCE_BROWSER' WHERE order_number=?").run(ORDER);
 f.sql.prepare("INSERT INTO rx_finance_exceptions(id,order_number,kind,state,owner_user_id,due_at,detail_json,created_at) VALUES('TEST-VARIANCE',?,'reconciliation_variance','open',1,?,?,?)").run(ORDER,due,JSON.stringify({variancePence:-300,sourceReference:'TEST-STATEMENT'}),created);
 f.sql.prepare("INSERT INTO rx_reconciliation_runs VALUES('TEST-ORIGINAL','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','TEST-STATEMENT',-300,'variance',?)").run(created);
 let browser,context;
 try{
  browser=await type.launch();context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!=='https://finance.fixture.test')throw Error('Unexpected external browser request');
   if(url.pathname==='/finance'){
    await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;background:#050505;color:#E7E3DA;font:16px Arial}main{max-width:100%;padding:12px}'+FUNCTIONAL_CSS+'</style><body class="rx-app" data-functional="true"><button data-rx-view="finance">Refresh Finance</button><p id="rx-notice" role="status"></p><main><section id="rx-finance"><div id="rx-finance-content"></div></section></main><script>'+FUNCTIONAL_CLIENT+'</script></body></html>'});return;
   }
   if(!url.pathname.startsWith('/api/clinical/platform/'))throw Error('Unexpected internal finance request');
   const suffix=url.pathname.slice('/api/clinical'.length),body=request.method()==='POST'?request.postDataJSON():undefined;
   const response=await f.hq(suffix,1,body);requests.push({path:url.pathname,method:request.method(),status:response.status,...body?{body}: {}});
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://finance.fixture.test/finance');const item=()=>page.locator('[data-finance-exception="TEST-VARIANCE"]');
  await item().waitFor();assert.equal(await page.getByLabel('Refund payment source',{exact:true}).inputValue(),'');
  checks.push({name:'Original payment retains an empty explicit selector value',pass:true});
  assert.match(await item().innerText(),/Awaiting verified matching financial evidence/);
  assert.equal(await item().getByRole('button',{name:'Resolve verified finance exception'}).count(),0);
  checks.push({name:'No financial completion control without verified evidence',pass:true});
  await item().getByText('Assign an owner or arrange cover',{exact:true}).click();
  const ownership=item().locator('[data-finance-ownership]');await ownership.getByLabel('Finance owner',{exact:true}).selectOption('2');
  await ownership.getByLabel('Ownership approval reference').fill('TEST-BROWSER-COVER');await ownership.getByLabel('Reason for this ownership change').fill('Fictional staff cover');
  await ownership.getByRole('button',{name:'Save finance ownership'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-finance-exception="TEST-VARIANCE"]')?.innerText.includes('Cover:'));
  const saved=f.sql.prepare("SELECT * FROM rx_finance_exceptions WHERE id='TEST-VARIANCE'").get();
  assert.equal(saved.owner_user_id,1);assert.equal(saved.cover_owner_id,2);assert.equal(saved.due_at,due);
  checks.push({name:'Actual cover UI persists primary owner, cover owner and original commitment',pass:true});
  await item().getByRole('button',{name:'View saved ownership history'}).click();await page.waitForFunction(()=>document.body.innerText.includes('TEST-BROWSER-COVER'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_exception_history').get().n,1);
  checks.push({name:'Saved ownership history renders the retained approval reference',pass:true});
  f.sql.prepare("INSERT INTO rx_reconciliation_runs VALUES('TEST-MATCHED','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','TEST-MATCHED-RECEIPT',0,'matched',?)").run(new Date().toISOString());
  await page.getByRole('button',{name:'Refresh Finance'}).click();await item().waitFor();
  await item().getByText('Resolve against confirmed financial evidence',{exact:true}).click();
  const resolution=item().locator('[data-finance-resolution]');await resolution.getByLabel('Verified matching statement').selectOption('TEST-MATCHED');
  await resolution.getByLabel('Resolution evidence reference').fill('TEST-BROWSER-RESOLUTION');await resolution.getByLabel('Reason this evidence resolves the exception').fill('Matching corrected source statement');
  await resolution.getByRole('button',{name:'Resolve verified finance exception'}).click();await item().waitFor({state:'detached'});
  assert.equal(f.sql.prepare("SELECT state FROM rx_finance_exceptions WHERE id='TEST-VARIANCE'").get().state,'closed');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_exception_history').get().n,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_entries').get().n,0);
  checks.push({name:'Resolution UI closes only the owned variance with a retained matching-period receipt; no money entry',pass:true});
  for(const width of [390,1366]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  checks.push({name:'Finance controls remain within mobile and desktop viewports',pass:true});
  f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());
  await page.getByRole('button',{name:'Refresh Finance'}).click();await page.waitForFunction(()=>!document.querySelector('#rx-finance-content')?.innerText.includes('Request a refund'));
  assert.equal(await page.locator('[data-finance-exception]').count(),0);
  checks.push({name:'Revoked session clears privileged financial controls',pass:true});
  assert.deepEqual(errors,[]);
  report.engines.push({engine,pass:true,checks,errors,requests});
 }catch(error){report.engines.push({engine,pass:false,checks,error:error.message,errors,requests});}
 finally{await context?.close();await browser?.close();f.close();}
 await fs.writeFile(output+'/results.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({engine,...report.engines.at(-1),requests:undefined}));
}
if(report.engines.some(result=>!result.pass))process.exitCode=1;
