import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,RECORD} from './fixture.mjs';
import {ensureFunctionalSchema,caseGateProof,informationList} from '../platform/functional-casework.mjs';
const j=async(r,status=200)=>{const s=await r.text();assert.equal(r.status,status,s);return JSON.parse(s)};
export async function functionalFixture(){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});await ensureFunctionalSchema(f.DB);
 const {ensurePlatformSchema}=await import('../platform/schema.mjs');await ensurePlatformSchema(f.DB);
 const config={verificationProtocol:{version:1,approvalReference:'TEST-PROVIDER-PROTOCOL-1',requirements:[{id:'identity',label:'Identity',methods:['independent_document'],allowException:false},{id:'measurements',label:'Height and weight',methods:['video','verified_record'],allowException:false}]}};
 f.sql.prepare("INSERT INTO rx_service_config VALUES('clinical-org','weight_management',1,?,?)").run(JSON.stringify(config),new Date().toISOString());
 await j(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));
 const cookie=await f.login('CLNTEST');
 const call=(suffix,body)=>f.hq('/platform/cases/'+RECORD+suffix,3,body);
 async function verify(requirement,extra={}){return j(await call('/verification',{assessmentVersion:1,requirement,state:'verified',method:requirement==='identity'?'independent_document':'video',sourceReference:'TEST-INDEPENDENT-RECEIPT-'+requirement,expiresAt:new Date(Date.now()+86400000).toISOString(),version:0,...extra}));}
 return {...f,cookie,call,verify};
}
test('RX-G1 pending mandatory measurements block native decision and sign proposal despite submitted checkbox claims',async()=>{
 const f=await functionalFixture();try{
  await j(await f.partner('/'+RECORD+'/action',f.cookie,{version:0,assessmentVersion:1,action:'start_review'}));
  await j(await f.partner('/'+RECORD+'/action',f.cookie,{version:1,assessmentVersion:1,action:'review_evidence',evidenceId:'front-photo-fixture',outcome:'approve'}));
  const decision={version:2,assessmentVersion:1,action:'decision',outcome:'proceed',identityVerified:true,independentMeasurementsVerified:true,verification:'TEST independent evidence',handover:f.handover,rationale:'TEST ONLY',message:'TEST review'};
  await j(await f.partner('/'+RECORD+'/action',f.cookie,decision),409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_requests').get().n,0);
  await f.verify('identity');await j(await f.partner('/'+RECORD+'/action',f.cookie,decision),409);
  await f.verify('measurements');await j(await f.partner('/'+RECORD+'/action',f.cookie,decision));
  assert.equal(f.sql.prepare('SELECT status FROM clinical_case_state WHERE record_id=?').get(RECORD).status,'ready_for_prescription');
 }finally{f.close();}
});
test('RX-G2 an exception is rejected unless the approved provider protocol explicitly permits it',async()=>{
 const f=await functionalFixture();try{
  await j(await f.call('/verification',{assessmentVersion:1,requirement:'measurements',state:'exception',method:'video',sourceReference:'TEST-RECEIPT',reason:'TEST exception',expiresAt:new Date(Date.now()+3600000).toISOString(),version:0}),403);
  const row=f.sql.prepare('SELECT config_json FROM rx_service_config').get(),c=JSON.parse(row.config_json);c.verificationProtocol.requirements[1].allowException=true;
  f.sql.prepare('UPDATE rx_service_config SET config_json=?,version=2').run(JSON.stringify(c));
  await f.verify('identity');await f.verify('measurements',{state:'exception',reason:'TEST provider-permitted exception'});
  const record=f.sql.prepare('SELECT * FROM clinical_member_records').get();const proof=await caseGateProof(f.env,record,{organisationId:'clinical-org'},1);assert(proof.sql.includes('rx_case_verifications'));
  f.sql.prepare("UPDATE rx_case_verifications SET expires_at='2000-01-01T00:00:00Z' WHERE requirement='measurements'").run();
  await assert.rejects(caseGateProof(f.env,record,{organisationId:'clinical-org'},1),/mandatory_verification_pending/);
 }finally{f.close();}
});
test('RX-IR1 structured information request, deadline, native event and outbox are one transaction',async()=>{
 const f=await functionalFixture();try{
  const body={version:0,assessmentVersion:1,message:'TEST please confirm current medicine',requestedFields:['medicines1Details'],dueAt:new Date(Date.now()+86400000).toISOString()};
  const d=await j(await f.call('/information',body));assert.equal(d.informationRequests.length,1);const request=d.informationRequests[0];assert.equal(request.status,'open');assert.deepEqual(request.fields,['medicines1Details']);
  const event=f.sql.prepare('SELECT kind FROM clinical_case_events WHERE id=?').get(request.id);assert.equal(event.kind,'information_requested');assert(f.sql.prepare('SELECT 1 ok FROM partner_workflow_sync WHERE source_key=?').get('clinical_case_events:'+request.id));
  f.sql.prepare("UPDATE rx_information_work SET due_at='2000-01-01T00:00:00Z'").run();assert.equal((await informationList(f.env,f.sql.prepare('SELECT * FROM clinical_member_records').get()))[0].status,'expired');
  await j(await f.call('/information',body),409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_information_work').get().n,1);
 }finally{f.close();}
});
test('RX-C2 response acknowledgement is bound to the immutable assessment version and changed fields',async()=>{
 const f=await functionalFixture();try{
  const d=await j(await f.call('/information',{version:0,assessmentVersion:1,message:'TEST medicine clarification',requestedFields:['medicines1Details'],dueAt:new Date(Date.now()+86400000).toISOString()}));const id=d.informationRequests[0].id;
  const old=f.sql.prepare('SELECT * FROM clinical_member_versions WHERE record_id=?').get(RECORD),answers={...JSON.parse(old.answers_json),medicines1Details:'TEST updated answer'};
  f.sql.prepare('INSERT INTO clinical_member_versions SELECT record_id,2,schema_version,?,evidence_json,declarations_json,?,submitted,created_at FROM clinical_member_versions WHERE record_id=? AND version=1').run(JSON.stringify(answers),'TEST-REVISION-2',RECORD);
  f.sql.prepare('UPDATE clinical_member_records SET revision=2 WHERE id=?').run(RECORD);
  await j(await f.member('/workflow/action',{version:1,assessmentVersion:2,action:'reply',requestId:id,message:'TEST updated answers'}));
  const shown=await j(await f.call(''));assert.equal(shown.informationRequests[0].status,'resubmitted');assert.equal(shown.informationRequests[0].diff[0].field,'medicines1Details');
  await j(await f.call('/information/'+id+'/acknowledge',{version:2,responseVersion:1}),409);
  await j(await f.call('/information/'+id+'/acknowledge',{version:2,responseVersion:2}));assert.equal((await j(await f.call(''))).informationRequests[0].status,'acknowledged');
 }finally{f.close();}
});
test('RX-SEC3 operations and another pharmacy cannot read clinical case details or record verification',async()=>{
 const f=await functionalFixture();try{
  for(const id of [1,4,5])await j(await f.hq('/platform/cases/'+RECORD,id),403);
  f.sql.prepare('UPDATE clinical_case_assignments SET active=0 WHERE hq_user_id=3').run();await j(await f.call(''),404);
 }finally{f.close();}
});
test('RX-AUD1 clinical reads produce an auditable hash-linked entry while retaining native actor and version',async()=>{
 const f=await functionalFixture();try{
  await j(await f.call(''));await j(await f.call(''));const rows=f.sql.prepare('SELECT * FROM rx_functional_audit ORDER BY rowid').all();assert.equal(rows.length,2);assert.equal(rows[1].previous_hash,rows[0].entry_hash);assert.equal(JSON.parse(rows[0].detail_json).assessmentVersion,1);assert.equal(rows[0].actor_id,'3');
 }finally{f.close();}
});
