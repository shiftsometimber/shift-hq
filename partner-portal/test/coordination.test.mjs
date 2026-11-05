import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,RECORD,ORDER} from './fixture.mjs';
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {actionFor} from '../platform/coordination.mjs';
import {syntheticLabEvent} from '../platform/diagnostics.mjs';
import portal from '../sstrx-worker.mjs';
import {withSharedOutbox} from '../service/shared-workflow.mjs';
import {hasOpenSupplyHold} from '../platform/supply-holds.mjs';
const json=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
async function setup(){const f=await fixture();await ensurePlatformSchema(f.DB);f.env.SSTRX_PLATFORM_ENABLED='true';f.env.SSTRX_ENVIRONMENT='synthetic';f.portalEnv.SSTRX_PORTAL_ENABLED='true';return f;}
async function signed(f){const r=await reviewAndPropose(f);await issue(f,r.cookie,r.proposal);return f.login('DSPTEST');}
test('every active case has an explicit next action, current named owner or an owner-required escalation; no invented deadline',async()=>{
 const f=await setup();try{let d=await json(await f.hq('/platform'));let r=d.records[0];assert.equal(r.action.code,'assign_review');assert.equal(r.action.unowned,true);assert.equal(r.action.dueAt,null);assert.equal(r.action.deadlineState,'not_configured');const before=f.order();
 await json(await f.hq('/platform/responsibility',1,{recordId:RECORD,sourceKey:r.action.key,version:0}));d=await json(await f.hq('/platform'));assert.equal(d.records[0].action.owner.userId,1);assert.deepEqual(f.order(),before);
 await json(await f.hq('/platform/responsibility',1,{recordId:RECORD,sourceKey:r.action.key,version:0}),409);
 await json(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));d=await json(await f.hq('/platform'));r=d.records[0];assert.equal(r.action.code,'clinical_review');assert.equal(r.action.owner.userId,3);assert.equal(r.action.owner.source,'current_clinical_assignment');
 await json(await f.hq('/platform/responsibility',1,{recordId:RECORD,sourceKey:r.action.key,version:0}),403);
 const hq=await json(await f.hq('/partner-desk'));assert.equal(hq.orders[0].action.owner.userId,3);assert.equal(hq.coordination.unowned,0);
 }finally{f.close()}
});
test('operational deadlines require explicit approval, preserve pathway configuration and escalate from the recorded stage clock',async()=>{
 const f=await setup();try{await json(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));f.sql.prepare('UPDATE clinical_case_state SET updated_at=?').run(new Date(Date.now()-30*60000).toISOString());
 const c=await f.login('CLNTEST'),b={orgId:'clinical-org',service:'weight_management',version:0,approvalReference:'FICTIONAL OPERATIONAL POLICY',windowsMinutes:{clinical_review:10}};
 await json(await f.partner('/platform/operational-policy',c,b),403);await json(await f.hq('/platform/operational-policy',1,b));await json(await f.hq('/platform/operational-policy',1,b),409);
 const d=await json(await f.hq('/platform'));assert.equal(d.coordination.overdue,1);assert.equal(d.records[0].action.escalation,'deadline_exceeded');assert.equal(d.records[0].action.clockSource,'approved_operational_policy');assert.equal(JSON.parse(f.sql.prepare('SELECT config_json FROM rx_service_config').get().config_json).enabled,undefined);
 f.sql.prepare("UPDATE partner_organisations SET state_json=json_set(state_json,'$.expiresAt',?) WHERE id='clinical-org'").run(new Date(Date.now()-1).toISOString());const e=await json(await f.hq('/platform'));assert.equal(e.records[0].action.owner,null);assert.equal(e.coordination.unowned,1);
 }finally{f.close()}
});
test('pharmacy responsibility is specific to the current stage and organisation; no clinical or order decision is made',async()=>{
 const f=await setup();try{const c=await signed(f);let d=await json(await f.partner('/platform',c)),r=d.records[0];assert.equal(r.action.code,'verify_prescription');assert.equal(r.action.unowned,true);
 await json(await f.partner('/platform/responsibility',c,{recordId:RECORD,sourceKey:r.action.key,version:0}));d=await json(await f.partner('/platform',c));assert.equal(d.records[0].action.owner.userId,4);assert.equal(f.order().clinical_status,'sent_to_pharmacy');
 const other=await f.login('DSPOTHER');await json(await f.partner('/platform/responsibility',other,{recordId:RECORD,sourceKey:r.action.key,version:0}),404);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version:0,action:'accept'}));d=await json(await f.partner('/platform',c));assert.equal(d.records[0].action.code,'dispense');assert.equal(d.records[0].action.owner,null);await json(await f.partner('/platform/responsibility',c,{recordId:RECORD,sourceKey:r.action.key,version:1}),409);
 }finally{f.close()}
});
test('reported temperature/damage/recall concerns hold native supply and need an authorised professional resolution',async()=>{
 const f=await setup();try{const c=await signed(f);await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version:0,action:'accept'}));const body={action:'open',kind:'temperature_concern',sourceReference:'FICTIONAL REPORT',clientReference:crypto.randomUUID()},h=await json(await f.hq('/platform/supply-holds/'+ORDER,1,body),201);
 assert.equal(h.supplyBlocked,true);assert.equal(h.prescriptionCancelled,false);assert.equal((await json(await f.hq('/platform/supply-holds/'+ORDER,1,body))).duplicate,true);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version:1,action:'prepare'}),409);assert.equal(f.order().clinical_status,'pharmacy_received');assert.equal((await json(await f.partner('/platform',c))).records[0].action.code,'review_supply_hold');
 await json(await f.hq('/platform/supply-holds/'+ORDER,1,{action:'resolve',id:h.id,version:1,reviewReference:'FICTIONAL OWNER'}),403);
 const other=await f.login('DSPOTHER');await json(await f.partner('/platform/supply-holds/'+ORDER,other,{action:'resolve',id:h.id,version:1,reviewReference:'FICTIONAL OTHER'}),404);
 await json(await f.partner('/platform/supply-holds/'+ORDER,c,{action:'resolve',id:h.id,version:1,reviewReference:'FICTIONAL QUALIFIED REVIEW'}));assert.equal(f.order().clinical_status,'pharmacy_received');
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version:1,action:'prepare'}));assert.equal(f.order().clinical_status,'dispensing');
 }finally{f.close()}
});
test('a hold racing the final native dispatch write prevents dispatch and its outbox transaction',async()=>{
 const f=await setup();try{const c=await signed(f);for(const [version,action]of [[0,'accept'],[1,'prepare']])await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version,action}));
 const original=f.DB.batch.bind(f.DB);let raced=false;f.DB.batch=async statements=>{if(!raced&&statements.some(s=>/^UPDATE partner_fulfilment/.test(s.sql)&&String(s.args?.[0]).includes('"status":"dispatched"'))){raced=true;const date=new Date().toISOString();f.sql.prepare("INSERT INTO rx_supply_holds VALUES('race',?,'recall',NULL,1,'open',1,'FICTIONAL CONCURRENT HOLD',NULL,?,?)").run(ORDER,date,date);}return original(statements);};
 const count=f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE entity_type='order' AND action='dispatch'").get().n;
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',c,{version:2,action:'dispatch',carrier:'dpd',trackingNumber:'12345678901234'}),409);assert.equal(raced,true);assert.equal(f.order().clinical_status,'dispensing');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE entity_type='order' AND action='dispatch'").get().n,count);assert.equal(f.sql.prepare('SELECT version FROM partner_fulfilment').get().version,2);
 }finally{f.close()}
});
test('laboratory critical flags require a named acknowledgement and recorded follow-up before review completes, without a real send',async()=>{
 const f=await setup();try{f.env.SSTRX_DIAGNOSTICS_ENABLED='true';const staff=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=3').get().state_json);staff.grants.push({...staff.grants[0],area:'diagnostics',actions:['request_test']});f.sql.prepare('UPDATE partner_staff SET state_json=? WHERE hq_user_id=3').run(JSON.stringify(staff));f.sql.prepare("INSERT INTO rx_supplier_contracts VALUES('lab','clinical-org','laboratory',1,'approved',?,?)").run('{"services":["diagnostics"]}',new Date().toISOString());const files=new Map();f.env.CLINICAL_PRIVATE_FILES={async put(k,v){files.set(k,v)},async get(k){return {body:files.get(k)}}};
 await json(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));const c=await f.login('CLNTEST'),o=await json(await f.partner('/platform/diagnostics',c,{recordId:RECORD,contractId:'lab',testCode:'FICTIONAL-PANEL',collectionMethod:'venous_collection',clinicalRequestReference:'FICTIONAL',clientReference:crypto.randomUUID()}),201);
 const event=(kind,extra={})=>syntheticLabEvent(f.env,{orderId:o.id,kind,eventReference:'FICTIONAL-'+kind,sourceReference:'FICTIONAL LAB',...extra});await event('submitted');await event('sample_received');const bytes=new TextEncoder().encode('%PDF-1.4 FICTIONAL'),extra={resultBytes:bytes,critical:true,responseDueAt:new Date(Date.now()-60000).toISOString(),criticalReference:'FICTIONAL LAB DEADLINE'};await event('result_available',extra);assert.equal((await event('result_available',extra)).duplicate,true);await assert.rejects(event('result_available',{...extra,resultBytes:new Uint8Array([1])}),/reference_conflict/);
 let d=await json(await f.partner('/platform',c));assert.equal(d.records[0].action.code,'critical_result_review');assert.equal(d.records[0].action.owner.userId,3);assert.equal(d.coordination.overdue,1);
 await json(await f.partner('/platform/diagnostics/'+o.id+'/review',c,{version:4,clinicalReviewReference:'FICTIONAL REVIEW'}),409);
 await json(await f.partner('/platform/diagnostics/'+o.id+'/acknowledge',c,{version:1,acknowledgementReference:'FICTIONAL ACK'}));assert.equal(f.sql.prepare('SELECT status FROM rx_diagnostic_orders').get().status,'result_available');
 await json(await f.partner('/platform/diagnostics/'+o.id+'/review',c,{version:4,clinicalReviewReference:'FICTIONAL REVIEW'}),422);
 await json(await f.partner('/platform/diagnostics/'+o.id+'/review',c,{version:4,clinicalReviewReference:'FICTIONAL REVIEW',followupPlanReference:'FICTIONAL CLINICIAN PLAN'}));d=await json(await f.partner('/platform',c));assert.notEqual(d.records[0].action.code,'critical_result_review');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE action='critical_result_acknowledged'").get().n,1);
 }finally{f.close()}
});
test('SST Rx owner login uses its own MFA-bound session and an oversight-only workspace; legacy portal remains professional-only',async()=>{
 const f=await setup();try{const origin='https://sstrx.shiftsometimber.co.uk',headers={Origin:origin,'Content-Type':'application/json'};
 const first=await portal.fetch(new Request(origin+'/api/login',{method:'POST',headers,body:JSON.stringify({username:'fixture-1@example.test',password:'Synthetic-only-password-987'})}),f.portalEnv);await json(first);const pending=first.headers.getSetCookie()[0].split(';')[0];const second=await portal.fetch(new Request(origin+'/api/mfa',{method:'POST',headers:{...headers,Cookie:pending},body:'{"code":"123456"}'}),f.portalEnv);await json(second);const cookie=second.headers.getSetCookie().find(x=>x.startsWith('__Host-shift_partner=')).split(';')[0];
 const call=path=>portal.fetch(new Request(origin+path,{headers:{Cookie:cookie}}),f.portalEnv);assert.equal((await json(await call('/api/identity'))).partner.kind,'oversight');assert.equal((await call('/workspace/overview')).status,200);assert.equal((await call('/workspace/clinical')).status,403);assert.equal((await call('/api/clinical/'+RECORD)).status,403);assert.equal((await call('/api/clinical/platform/commercial/'+ORDER)).status,403);assert.equal((await call('/api/clinical/platform')).status,200);
 f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());await json(await call('/api/clinical/platform'),401);
 }finally{f.close()}
});
test('operational status never manufactures dispatch, delivery, a prescriber or a deadline',()=>{
 assert.equal(actionFor({assigned:true,clinicalStatus:'prescription_issued'}).code,'confirm_handover');assert.equal(actionFor({pharmacyStatus:'dispatched'}).code,'await_delivery');assert.equal(actionFor({pharmacyStatus:'delivered'}).responsibility,null);assert.equal(actionFor({syncPending:1,pharmacyStatus:'delivered'}).code,'reconcile_status');
});
test('fresh transactional requests reuse the existing D1 schema cache rather than running migrations during each supply check',async()=>{
 const f=await setup();try{let migrations=0;const prepare=f.DB.prepare;f.DB.prepare=sql=>{if(/^CREATE /.test(sql))migrations++;return prepare(sql);};for(let i=0;i<4;i++)assert.equal(await hasOpenSupplyHold(withSharedOutbox(f.env),ORDER),false);assert.equal(migrations,0);}finally{f.close()}
});
