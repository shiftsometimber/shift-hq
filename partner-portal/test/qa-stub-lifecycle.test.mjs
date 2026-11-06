import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalDataset} from '../qa/functional-fixtures.mjs';
import {RECORD} from './fixture.mjs';
const j=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
async function fixture(){
 const f=await functionalDataset('E'),marker='11111111-1111-4111-8111-111111111111';Object.assign(f.env,{SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:marker,SSTRX_QA_FULFILMENT_ENABLED:'true'});f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT PRIMARY KEY,database_id TEXT,synthetic_only INTEGER)');f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',marker);
 const made=await j(await f.hq('/platform/integrations/stub-contract',1,{contractReference:'TEST-LIFECYCLE-NATIVE',clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',variantId:11,approvalReference:'TEST-SETUP-AUTHORITY'}));
 // Match hosted QA, which has verification rules but no lifecycle fixture rules.
 for(const row of f.sql.prepare('SELECT * FROM rx_service_config').all()){const config=JSON.parse(row.config_json);delete config.lifecycleProtocol;f.sql.prepare('UPDATE rx_service_config SET config_json=? WHERE org_id=? AND service=?').run(JSON.stringify(config),row.org_id,row.service);}
 const version=id=>f.sql.prepare("SELECT version FROM rx_service_config WHERE org_id=? AND service='weight_management'").get(id)?.version||0;
 const command={contractId:made.contractId,clinicalVersion:version('clinical-org'),pharmacyVersion:version('pharmacy-org'),approvalReference:'TEST-FICTIONAL-LIFECYCLE-ONLY',clientReference:crypto.randomUUID()};
 const call=(body=command,actor=1)=>f.hq('/platform/integrations/stub-lifecycle',actor,body);
 const request=()=>f.hq('/platform/lifecycle/'+RECORD,3,{version:JSON.parse(f.sql.prepare('SELECT state_json FROM clinical_prescription_requests WHERE record_id=?').get(RECORD).state_json).version,kind:'cancel',reason:'TEST fictional withdrawal',message:'TEST supply on hold pending pharmacy acknowledgement',dueAt:new Date(Date.now()+3600000).toISOString(),financeOwnerId:1,clientReference:crypto.randomUUID()});
 return {...f,command,call,request};
}
test('Owner TEST setup retains existing verification rules and prepares two explicitly simulated lifecycle protocols once',async()=>{
 const f=await fixture();try{
 const before=f.sql.prepare('SELECT org_id,config_json FROM rx_service_config').all();const result=await j(await f.call());assert.equal(result.simulation,true);assert.equal(result.clinicalProtocolApproved,false);assert.equal(result.pharmacyProtocolApproved,false);
 for(const row of f.sql.prepare('SELECT * FROM rx_service_config').all()){const config=JSON.parse(row.config_json),old=before.find(x=>x.org_id===row.org_id);assert.equal(config.lifecycleProtocol.simulation,true);assert.equal(config.lifecycleProtocol.freshSignatureForReplacement,true);if(old)for(const[k,v]of Object.entries(JSON.parse(old.config_json)))assert.deepEqual(config[k],v);}
 const snapshot=f.sql.prepare('SELECT * FROM rx_service_config ORDER BY org_id').all();assert.equal((await j(await f.call())).duplicate,true);assert.deepEqual(f.sql.prepare('SELECT * FROM rx_service_config ORDER BY org_id').all(),snapshot);await j(await f.call({...f.command,approvalReference:'TEST-CHANGED'}),409);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE action='fictional_protocols_prepared'").get().n,1);
 }finally{f.close()}
});
test('Live mode, wrong database, non-owner and stale versions cannot prepare fictional lifecycle rules',async()=>{
 const f=await fixture();try{
 await j(await f.call(f.command,6),403);
 for(const change of [{SSTRX_ENVIRONMENT:'production'},{SSTRX_QA_DATABASE_ID:'22222222-2222-4222-8222-222222222222'},{SSTRX_QA_FULFILMENT_ENABLED:'false'}]){const saved={...f.env};Object.assign(f.env,change);await j(await f.call(),503);Object.assign(f.env,saved);}
 await j(await f.call({...f.command,clinicalVersion:f.command.clinicalVersion+1}),409);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE action='fictional_protocols_prepared'").get().n,0);
 }finally{f.close()}
});
test('Existing professional rules and unmarked contract/catalogue records are never replaced by a test setup',async()=>{
 const f=await fixture();try{
 const old=f.sql.prepare("SELECT config_json FROM rx_service_config WHERE org_id='clinical-org'").get();const config={...JSON.parse(old?.config_json||'{}'),lifecycleProtocol:{approvalReference:'EXISTING-CLINICAL-APPROVAL'}};f.sql.prepare("INSERT INTO rx_service_config VALUES('clinical-org','weight_management',?, ?,?) ON CONFLICT(org_id,service) DO UPDATE SET config_json=excluded.config_json").run(f.command.clinicalVersion||1,JSON.stringify(config),new Date().toISOString());f.command.clinicalVersion=f.sql.prepare("SELECT version FROM rx_service_config WHERE org_id='clinical-org'").get().version;await j(await f.call(),409);assert.deepEqual(JSON.parse(f.sql.prepare("SELECT config_json FROM rx_service_config WHERE org_id='clinical-org'").get().config_json),config);
 f.sql.prepare("UPDATE medicine_products SET name='Actual catalogue medicine'").run();await j(await f.call(),409);
 }finally{f.close()}
});
test('Audit failure rolls back both fictional protocol updates',async()=>{
 const f=await fixture();try{
 const before=f.sql.prepare('SELECT * FROM rx_service_config ORDER BY org_id').all();f.sql.exec("CREATE TRIGGER fail_protocol_audit BEFORE INSERT ON rx_platform_audit WHEN NEW.action='fictional_protocols_prepared' BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END;");await j(await f.call(),503);assert.deepEqual(f.sql.prepare('SELECT * FROM rx_service_config ORDER BY org_id').all(),before);
 }finally{f.close()}
});
test('Prepared fake rules support the real cancellation gates; the signed document survives withdrawal',async()=>{
 const f=await fixture();try{
 await j(await f.call());const original=f.sql.prepare('SELECT * FROM clinical_prescription_signatures').all(),withdrawal=await j(await f.request());assert.equal(withdrawal.state,'requested');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_supply_holds WHERE state='open'").get().n,1);
 await j(await f.hq('/platform/lifecycle/'+RECORD+'/'+withdrawal.id+'/acknowledge',5,{version:1,reference:'TEST-WRONG-PHARMACY',disposition:'not_supplied'}),404);
 const closed=await j(await f.hq('/platform/lifecycle/'+RECORD+'/'+withdrawal.id+'/acknowledge',4,{version:1,reference:'TEST-PHARMACY-WITHDRAWAL',disposition:'not_supplied'}));assert.equal(closed.state,'closed');assert.deepEqual(f.sql.prepare('SELECT * FROM clinical_prescription_signatures').all(),original);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'cancelled');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clinical_prescription_finance_tasks WHERE kind='cancellation_review' AND status='awaiting_review'").get().n,1);
 }finally{f.close()}
});
test('A simulated protocol cannot authorise live lifecycle work even if production release flags are supplied',async()=>{
 const f=await fixture();try{await j(await f.call());Object.assign(f.env,{SSTRX_ENVIRONMENT:'production',SSTRX_LIFECYCLE_WRITES_ENABLED:'true',SSTRX_LIFECYCLE_RELEASE_APPROVAL_REFERENCE:'LOCAL-TEST-NOT-A-RELEASE'});const denied=await j(await f.request(),409);assert.equal(denied.error,'simulated_protocol_not_for_live_supply');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_prescription_lifecycle').get().n,0);}finally{f.close()}
});
