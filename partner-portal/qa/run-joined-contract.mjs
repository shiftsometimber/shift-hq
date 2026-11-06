// Explicit two-repository acceptance driver. Every record and transport is
// synthetic; both projections read the very same native D1-compatible fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {functionalDataset} from './functional-fixtures.mjs';
import memberService from '../service/member-service.mjs';
const source=process.env.SSTRX_QA_CORE_SOURCE;
if(!source||!path.isAbsolute(source))throw Error('Supply the exact checked-out Core hq-v3-api.mjs path. No production target is accepted.');
const {hqV3Route}=await import(pathToFileURL(source));
const f=await functionalDataset('J');
try{
 Object.assign(f.env,{HQ_V3_TEST_MODE:'true',DEPLOYMENT_ENVIRONMENT:'test'});
 assert.equal(f.env.SSTRX_ENVIRONMENT,'synthetic');
 const req=new Request('https://api.shiftsometimber.co.uk/v1/hq/management/v3/purchases?period=TODAY',{headers:{Cookie:'sst_hq_session='+f.tokens[1]}});
 const coreResponse=await hqV3Route(req,f.env,{},request=>f.env.HQ_AUTH.fetch(request));assert.equal(coreResponse.status,200,await coreResponse.clone().text());
 const commercial=await coreResponse.json(),line=commercial.orders.find(o=>o.order_ref===f.order);assert(line,'Native synthetic order must be visible in the Core commercial projection');
 const opsResponse=await f.hq('/partner-desk/operations',1);assert.equal(opsResponse.status,200,await opsResponse.clone().text());const operations=await opsResponse.json(),ops=operations.records.find(r=>r.order_ref===f.order);
 const memberResponse=await memberService.fetch(new Request('https://my-timber.app/v1/member/my-shift',{headers:{Cookie:'sst_session='+f.memberToken,Origin:'https://my-timber.app'}}),f.env);assert.equal(memberResponse.status,200,await memberResponse.clone().text());const member=await memberResponse.json(),order=member.orders.find(o=>o.reference===f.order);
 assert.equal(line.rx_case_ref,ops.case_ref);assert.equal(order.recordId,ops.case_ref);
 for(const key of ['accepted','dispensed','dispatched','delivered']){const hq=ops.milestones.find(s=>s.key===key),my=order.timeline.find(s=>s.key===key);assert(hq.confirmed&&my.complete,key);assert.equal(hq.at,my.at,key);}
 for(const value of ['James Example','FICTIONAL ALTERNATIVE ADDRESS'])assert(!JSON.stringify(commercial).includes(value)&&!JSON.stringify(operations).includes(value));
 const report={scope:'Synthetic same-database cross-repository contract; not hosted or live acceptance',observedAt:new Date().toISOString(),coreSourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),orderReference:f.order,caseReference:ops.case_ref,commercial:{orderReference:line.order_ref,caseReference:line.rx_case_ref,scope:line.ref_mapping_status},operational:{orderReference:ops.order_ref,caseReference:ops.case_ref,milestones:ops.milestones},member:{orderReference:order.reference,caseReference:order.recordId,timeline:order.timeline},sameNativeRecords:true,clinicalBodiesInHQ:false,externalCalls:false,result:'PASS'};
 if(process.env.SSTRX_JOINED_EVIDENCE){await fs.mkdir(path.dirname(process.env.SSTRX_JOINED_EVIDENCE),{recursive:true});await fs.writeFile(process.env.SSTRX_JOINED_EVIDENCE,JSON.stringify(report,null,2));}
 console.log(JSON.stringify({result:report.result,orderReference:f.order,caseReference:ops.case_ref,sameNativeRecords:true,scope:report.scope}));
}finally{f.close();}
