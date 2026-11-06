import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {functionalClient} from '../platform/functional-ui.mjs';
import {allowedPath} from '../policy.mjs';
test('Owner prepares fictional withdrawal rules through the actual form once; saved versions survive refresh in both browsers',async()=>{
 for(const type of [chromium,webkit]){
 const browser=await type.launch({headless:true});try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});let written=false,posts=0;const contractId='TEST-STUB-CONTRACT-ui',calls=[];
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());calls.push({method:req.method(),path:u.pathname});
 if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<body data-functional="true"><section id="rx-finance"><div id="rx-finance-content"></div></section><p id="rx-notice" role="alert"></p></body>'});
 const root='/api/clinical/platform';
 if(u.pathname===root+'/refunds')return route.fulfill({json:{refunds:[],paymentSources:[],fullCommercial:true}});
 if(u.pathname===root+'/finance-exceptions')return route.fulfill({json:{exceptions:[],owners:[],matchedStatements:[]}});
 if(u.pathname===root)return route.fulfill({json:{qaProviderManagementAvailable:true,records:[]}});
 if(u.pathname===root+'/integrations')return route.fulfill({json:{testLifecycleSetupAvailable:true,jobs:[],contracts:[{id:contractId,org_id:'test-clinic',clinical_config_version:written?4:3,pharmacy_config_version:written?1:0,config_json:JSON.stringify({simulation:true,contractReference:'TEST-UI',pharmacyOrgId:'test-pharmacy'})}],testOrganisations:[],testVariants:[]}});
 if(u.pathname===root+'/integrations/stub-lifecycle'&&req.method()==='POST'){const body=req.postDataJSON();assert.equal(body.contractId,contractId);assert.equal(body.clinicalVersion,3);assert.equal(body.pharmacyVersion,0);assert.equal(body.approvalReference,'TEST-ONLY-FICTIONAL-WITHDRAWAL');assert.match(body.clientReference,/^[a-f0-9-]{36}$/);posts++;written=true;return route.fulfill({json:{simulation:true,clinicalProtocolApproved:false,pharmacyProtocolApproved:false,clinicalVersion:4,pharmacyVersion:1}});}
 throw Error('Unexpected request '+req.method()+' '+u.pathname);});
 const load=async()=>{await page.goto('https://rx-qa.sstrx.co.uk/finance');await page.addScriptTag({content:'('+functionalClient.toString()+')();'});await page.getByText('TEST provider setup · owner controls',{exact:true}).waitFor();};
 await load();await page.getByText('TEST provider setup · owner controls',{exact:true}).click();await page.getByText('Fictional withdrawal rules · TEST-UI',{exact:true}).click();const button=page.getByRole('button',{name:'Prepare fictional withdrawal rules',exact:true});await button.evaluate(b=>{b.click();b.click()});await page.getByText('Fictional withdrawal rules saved. No real clinical or pharmacy approval was recorded.',{exact:true}).waitFor();assert.equal(posts,1);
 await load();assert.equal(posts,1);assert.equal(calls.some(x=>x.path.includes('stub-handover')&&x.method==='POST'),false);await page.close();
 }
 }finally{await browser.close()}
 }
});
test('Only oversight POST may prepare a fictional protocol fixture through the portal',()=>{
 const path='/api/clinical/platform/integrations/stub-lifecycle';assert.equal(allowedPath(path,'POST','oversight'),true);for(const role of ['clinician','dispensing','clinical_admin','pharmacy_admin','support'])assert.equal(allowedPath(path,'POST',role),false);for(const method of ['GET','PUT','DELETE'])assert.equal(allowedPath(path,method,'oversight'),false);assert.equal(allowedPath(path+'/extra','POST','oversight'),false);
});
