import assert from 'node:assert/strict';
import {fixture,RECORD} from '../fixture.mjs';
import {ensureFunctionalSchema} from '../../platform/functional-casework.mjs';
const j=async(r,status=200)=>{const s=await r.text();assert.equal(r.status,status,s);return JSON.parse(s)};
export async function functionalFixture(base){
 const f=base||await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});await ensureFunctionalSchema(f.DB);
 const {ensurePlatformSchema}=await import('../../platform/schema.mjs');await ensurePlatformSchema(f.DB);
 const config={verificationProtocol:{version:1,approvalReference:'TEST-PROVIDER-PROTOCOL-1',requirements:[{id:'identity',label:'Identity',methods:['independent_document'],allowException:false},{id:'measurements',label:'Height and weight',methods:['video','verified_record'],allowException:false}]}};
 f.sql.prepare("INSERT INTO rx_service_config VALUES('clinical-org','weight_management',1,?,?)").run(JSON.stringify(config),new Date().toISOString());
 await j(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));
 const cookie=await f.login('CLNTEST');
 const call=(suffix,body)=>f.hq('/platform/cases/'+RECORD+suffix,3,body);
 async function verify(requirement,extra={}){return j(await call('/verification',{assessmentVersion:1,requirement,state:'verified',method:requirement==='identity'?'independent_document':'video',sourceReference:'TEST-INDEPENDENT-RECEIPT-'+requirement,expiresAt:new Date(Date.now()+86400000).toISOString(),version:0,...extra}));}
 return {...f,cookie,call,verify};
}
