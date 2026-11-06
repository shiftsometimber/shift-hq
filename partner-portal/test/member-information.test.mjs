import {completeAssessment} from './helpers/complete-assessment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalFixture} from './helpers/functional-fixture.mjs';
import {RECORD} from './fixture.mjs';
import member from '../service/member-service.mjs';
const j=async(r,status=200)=>{const t=await r.text();assert.equal(r.status,status,t);return JSON.parse(t)};
async function setup(){
 const f=await completeAssessment(await functionalFixture());
 const request=await j(await f.call('/information',{version:0,assessmentVersion:1,message:'TEST current medicine details',requestedFields:['medicines1Details'],dueAt:new Date(Date.now()+3600000).toISOString()}));const id=request.informationRequests[0].id;
 const body={clientReference:crypto.randomUUID(),requestVersion:1,revision:1,answers:{medicines1Details:'FICTIONAL revised medicine detail'},accuracy:true,reviewSharing:true};
 return {...f,id,body,respond:(b=body)=>f.member('/information/'+id+'/respond',b)};
}
test('MS-IR1 / RX-C2 member response uses the native assessment validator, version store, case reply, outbox and clinician acknowledgement',async()=>{
 const f=await setup();try{
  const result=await j(await f.respond());assert(result.recorded);assert.equal(result.assessmentVersion,2);assert.equal(result.clinicalApproval,false);
  const item=f.sql.prepare('SELECT * FROM rx_information_work').get();assert.equal(item.state,'resubmitted');assert.equal(item.response_version,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,2);
  assert.equal(f.sql.prepare('SELECT state FROM rx_member_information_commands').get().state,'completed');
  assert((await j(await f.respond())).duplicate);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,2);
  await j(await f.respond({...f.body,answers:{fullName:'UNREQUESTED CHANGE'}}),409);
  const clinical=await j(await f.call(''));assert.equal(clinical.informationRequests[0].diff[0].field,'medicines1Details');
  await j(await f.call('/information/'+f.id+'/acknowledge',{version:2,responseVersion:2}));
 }finally{f.close();}
});
test('RX-IR3 a lost case-reply transaction resumes the saved native assessment instead of creating another version',async()=>{
 const f=await setup();try{
  const batch=f.DB.batch.bind(f.DB);let dropped=false;f.DB.batch=async commands=>{if(!dropped&&commands.some(s=>s.sql.startsWith('INSERT INTO clinical_case_events'))){dropped=true;throw Error('TEST case reply connection lost');}return batch(commands)};
  await j(await f.respond(),503);assert.equal(f.sql.prepare('SELECT state FROM rx_member_information_commands').get().state,'assessment_saved');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,2);
  await j(await f.respond());assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,2);assert.equal(f.sql.prepare('SELECT state FROM rx_member_information_commands').get().state,'completed');
 }finally{f.close();}
});
test('RX-IR4 unexpected answer fields, missing confirmation and a revoked session leave no new clinical version',async()=>{
 const f=await setup();try{
  await j(await f.respond({...f.body,answers:{fullName:'NOT REQUESTED'}}),422);await j(await f.respond({...f.body,accuracy:false}),422);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,1);
  f.sql.prepare("UPDATE user_sessions SET revoked_at='2026-01-01T00:00:00Z'").run();await j(await f.respond(),401);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_member_versions').get().n,1);
 }finally{f.close();}
});
