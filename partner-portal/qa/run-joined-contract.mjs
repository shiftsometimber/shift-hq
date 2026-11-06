// Explicit two-repository acceptance driver. Every record and transport is
// synthetic; both projections read the very same native D1-compatible fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {functionalDataset} from './functional-fixtures.mjs';
import {fixture} from '../test/fixture.mjs';
import memberService from '../service/member-service.mjs';
const source=process.env.SSTRX_QA_CORE_SOURCE;
if(!source||!path.isAbsolute(source))throw Error('Supply the exact checked-out Core hq-v3-api.mjs path. No production target is accepted.');
const {hqV3Route}=await import(pathToFileURL(source));
const governanceSource=path.join(path.dirname(source),'hq-catalogue-governance-v31.mjs');
const governance=await import(pathToFileURL(governanceSource));
async function catalogueAuthorizationContract(){
 const c=await fixture();
 try{
  Object.assign(c.env,{SSTRX_PLATFORM_ENABLED:'true',HQ_CATALOGUE_V31_TEST_MODE:'true',SSTRX_ENVIRONMENT:'synthetic'});
  c.sql.exec("UPDATE medicine_products SET name='TEST-MED-A' WHERE id=1");
  const row=c.sql.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=3').get(),staff=JSON.parse(row.state_json);
  for(const grant of staff.grants)if(grant.area==='weight_management')grant.medicines=['TEST-MED-A'];
  c.sql.prepare('UPDATE partner_staff SET version=version+1,state_json=? WHERE hq_user_id=3').run(JSON.stringify(staff));
  const until=new Date(Date.now()+3600000).toISOString();
  c.env.CATALOGUE_SIGNOFF_TEST_GRANTS=JSON.stringify([{user_id:3,org_id:staff.orgId,variant_id:11,permission:'catalogue_signoff',approval_ref:'TEST-CROSS-REPOSITORY-CATALOGUE',expires_at:until}]);
  await governance.ensureCatalogueGovernanceSchema(c.DB);
  c.sql.prepare("INSERT INTO catalogue_supply_routes VALUES('medicine_variant',11,'pharmacy-org','primary','ready',20,0,1,'available',?,'TEST-SUPPLIER-STOCK',1,1,?)").run(until,new Date().toISOString());
  const before=await governance.readCatalogueAuthority(c.DB,11);assert.equal(before.canBuy,false);assert(before.blockers.includes('current_prescriber_signoff_required'));
  const body={productVersion:1,variantVersion:1,acknowledge:true};
  assert.equal((await c.hq('/platform/catalogue/11',1,body)).status,403);
  const signed=await c.hq('/platform/catalogue/11',3,body);assert.equal(signed.status,200,await signed.clone().text());const receipt=await signed.json();assert.equal(receipt.patientPrescriptionCreated,false);
  const after=await governance.readCatalogueAuthority(c.DB,11);assert.equal(after.canBuy,true);assert.equal(after.signoff.who,3);assert.equal(after.selectedPartner,'pharmacy-org');
  const guard=governance.catalogueReservationGuard(after),query=c.DB.prepare('SELECT 1 permitted WHERE '+guard.sql).bind(...guard.args);assert.equal((await query.first()).permitted,1);
  c.sql.exec('UPDATE medicine_products SET catalogue_version=catalogue_version+1 WHERE id=1');
  const changed=await governance.readCatalogueAuthority(c.DB,11);assert.equal(changed.canBuy,false);assert(changed.blockers.includes('current_prescriber_signoff_required'));assert.equal(await c.DB.prepare('SELECT 1 permitted WHERE '+guard.sql).bind(...guard.args).first(),null);
  assert.equal(c.sql.prepare('SELECT COUNT(*) n FROM catalogue_prescriber_approvals').get().n,1);
  return {result:'PASS',scope:'Actual authenticated Rx sign-off and actual Core catalogue/transaction guard over the same isolated SQLite; not provider commissioning or a checkout capture',variantId:11,approvalId:receipt.approval.id,prescriberId:receipt.approval.who,selectedPartner:after.selectedPartner,missingApprovalBlocked:true,hqOwnerDenied:true,currentApprovalAccepted:true,newVersionInvalidatesReadAndAtomicGuard:true,originalApprovalRetained:true,patientPrescriptionCreated:false,moneyMoved:false,externalCalls:false,coreGovernanceSha256:createHash('sha256').update(await fs.readFile(governanceSource)).digest('hex')};
 }finally{c.close();}
}
const f=await functionalDataset('J');
try{
 Object.assign(f.env,{HQ_V3_TEST_MODE:'true',DEPLOYMENT_ENVIRONMENT:'test'});
 assert.equal(f.env.SSTRX_ENVIRONMENT,'synthetic');
 const req=new Request('https://api.shiftsometimber.co.uk/v1/hq/management/v3/purchases?period=TODAY',{headers:{Cookie:'sst_hq_session='+f.tokens[1]}});
 const coreResponse=await hqV3Route(req,f.env,{},request=>f.env.HQ_AUTH.fetch(request));assert.equal(coreResponse.status,200,await coreResponse.clone().text());
 const commercial=await coreResponse.json(),line=commercial.orders.find(o=>o.order_ref===f.order);assert(line,'Native synthetic order must be visible in the Core commercial projection');
 const drillURL=new URL(req.url);drillURL.pathname+='/'+encodeURIComponent(f.order);const drillResponse=await hqV3Route(new Request(drillURL,{headers:req.headers}),f.env,{},request=>f.env.HQ_AUTH.fetch(request));assert.equal(drillResponse.status,200,await drillResponse.clone().text());const drill=(await drillResponse.json()).purchase;assert.equal(drill.refs.case_ref,line.rx_case_ref);assert.equal(drill.order_ref,f.order);assert.equal(drill.clinical_detail_in_hq,false);
 const opsResponse=await f.hq('/partner-desk/operations',1);assert.equal(opsResponse.status,200,await opsResponse.clone().text());const operations=await opsResponse.json(),ops=operations.records.find(r=>r.order_ref===f.order);
 const memberResponse=await memberService.fetch(new Request('https://my-timber.app/v1/member/my-shift',{headers:{Cookie:'sst_session='+f.memberToken,Origin:'https://my-timber.app'}}),f.env);assert.equal(memberResponse.status,200,await memberResponse.clone().text());const member=await memberResponse.json(),order=member.orders.find(o=>o.reference===f.order);
 assert.equal(line.rx_case_ref,ops.case_ref);assert.equal(order.recordId,ops.case_ref);
 for(const key of ['accepted','dispensed','dispatched','delivered']){const hq=ops.milestones.find(s=>s.key===key),my=order.timeline.find(s=>s.key===key);assert(hq.confirmed&&my.complete,key);assert.equal(hq.at,my.at,key);}
 for(const value of ['James Example','FICTIONAL ALTERNATIVE ADDRESS'])assert(!JSON.stringify(commercial).includes(value)&&!JSON.stringify(operations).includes(value));
 const catalogue=await catalogueAuthorizationContract();
 const report={scope:'Synthetic same-database cross-repository contract; not hosted or live acceptance',observedAt:new Date().toISOString(),coreSourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),orderReference:f.order,caseReference:ops.case_ref,commercial:{orderReference:line.order_ref,caseReference:line.rx_case_ref,scope:line.ref_mapping_status},purchaseDrill:{orderReference:drill.order_ref,caseReference:drill.refs.case_ref},operational:{orderReference:ops.order_ref,caseReference:ops.case_ref,milestones:ops.milestones},member:{orderReference:order.reference,caseReference:order.recordId,timeline:order.timeline},catalogue,sameNativeRecords:true,clinicalBodiesInHQ:false,externalCalls:false,result:'PASS'};
 if(process.env.SSTRX_JOINED_EVIDENCE){await fs.mkdir(path.dirname(process.env.SSTRX_JOINED_EVIDENCE),{recursive:true});await fs.writeFile(process.env.SSTRX_JOINED_EVIDENCE,JSON.stringify(report,null,2));}
 console.log(JSON.stringify({result:report.result,orderReference:f.order,caseReference:ops.case_ref,sameNativeRecords:true,scope:report.scope}));
}finally{f.close();}
