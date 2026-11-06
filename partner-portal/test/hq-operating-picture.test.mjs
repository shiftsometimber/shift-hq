import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER,RECORD} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {hqOperatingPicture} from '../service/hq-operating-picture.mjs';
import {myShiftFixture,signedRxFixture} from '../qa/my-shift-fixture.mjs';
const setup=async()=>{const f=await fixture();await ensurePlatformSchema(f.DB);Object.assign(f.env,{HQ_V3_TEST_MODE:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_PLATFORM_ENABLED:'true'});f.sql.prepare("UPDATE users SET email='fictional-member@example.invalid' WHERE id=42").run();f.sql.prepare("UPDATE medicine_orders SET email='fictional-member@example.invalid',stripe_checkout_session_id='cs_test_SYNTHETIC' WHERE id=1").run();return f;};
test('Existing Partner Desk identity/MFA protects the TEST operations projection; no clinical commands are admitted',async()=>{
 const f=await setup();try{
  let response=await f.hq('/partner-desk/operations');assert.equal(response.status,200);let d=await response.json();assert.equal(d.records[0].order_ref,ORDER);assert.equal(d.records[0].case_ref,RECORD);assert.equal(d.clinical_commands_available,false);
  response=await f.hq('/partner-desk/operations?partition=LIVE');assert.equal(response.status,403);
  response=await f.hq('/partner-desk/operations',4);assert.equal(response.status,403);
  f.sql.prepare('UPDATE hq_users SET mfa_enabled=0 WHERE id=1').run();response=await f.hq('/partner-desk/operations');assert.equal(response.status,403);assert.equal((await response.json()).error,'mfa_required');
  f.sql.prepare('UPDATE hq_users SET mfa_enabled=1 WHERE id=1').run();delete f.env.HQ_V3_TEST_MODE;response=await f.hq('/partner-desk/operations');assert.equal(response.status,503);
 }finally{f.close();}
});
test('Metadata comes from canonical Rx rows; it cannot infer acceptance, dispensing or delivery, or copy clinical text',async()=>{
 const f=await setup();try{
  let d=await hqOperatingPicture(f.env,{id:1,role:'owner',internal:true});const record=d.records[0];assert.equal(record.order_ref,ORDER);assert.equal(record.case_ref,RECORD);assert.ok(record.milestones.every(x=>!x.confirmed));assert.equal(record.action.unowned,true);
  // A status string by itself is not a receipt for any milestone.
  f.sql.prepare("INSERT INTO partner_fulfilment(order_number,partner_id,member_id,version,state_json,updated_at) VALUES(?, 'pharmacy-org',42,1,?,?)").run(ORDER,JSON.stringify({status:'delivered',medicine:'PRIVATE MEDICINE',directions:'PRIVATE CLINICAL DIRECTIONS'}),new Date().toISOString());
  d=await hqOperatingPicture(f.env,{id:1,role:'owner',internal:true});assert.equal(d.records[0].milestones.find(x=>x.key==='delivered').confirmed,false);assert.ok(!JSON.stringify(d).includes('PRIVATE'));assert.ok(!JSON.stringify(d).includes('Fictional home address'));
  const date='2026-11-05T10:00:00Z';f.sql.prepare("INSERT INTO partner_audit(id,entity_type,entity_id,version,actor_id,action,details_json,created_at) VALUES('TEST-RECEIPT','order',?,1,4,'fulfilment_accept','{}',?)").run(ORDER,date);
  d=await hqOperatingPicture(f.env,{id:1,role:'owner',internal:true});const acceptance=d.records[0].milestones.find(x=>x.key==='accepted');assert.equal(acceptance.confirmed,true);assert.equal(acceptance.at,date);assert.equal(acceptance.evidence_ref,'TEST-RECEIPT');assert.equal(d.records[0].milestones.find(x=>x.key==='dispensed').confirmed,false);
 }finally{f.close();}
});
test('Native synthetic Rx actions, My Shift and HQ use the same references and original receipt times',async()=>{
 const f=await myShiftFixture();try{
  Object.assign(f.env,{HQ_V3_TEST_MODE:'true',SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'test',SSTRX_TEST_SIGNING:'true'});
  f.sql.prepare("UPDATE medicine_orders SET email='fictional-member@example.invalid',stripe_checkout_session_id='cs_test_V3_ONLY' WHERE id=1").run();
  const rx=await signedRxFixture(f);
  for(const [version,action,key]of [[0,'accept','accepted'],[1,'prepare',null],[2,'dispensed','dispensed'],[3,'dispatch','dispatched'],[4,'delivered','delivered']]){
   await rx.call('/partners/fulfilment/'+ORDER+'/action',rx.pharmacy,{version,action,carrier:'dpd',trackingNumber:'12345678901234',message:'FICTIONAL TEST receipt; no parcel or external transaction'});
   const native=await rx.call('/partners/fulfilment/'+ORDER,rx.pharmacy),member=await(await f.call()).json(),response=await f.hq('/partner-desk/operations');assert.equal(response.status,200);const hq=await response.json();
   assert.equal(native.order.orderNumber,ORDER);assert.equal(member.orders[0].reference,ORDER);assert.equal(hq.records[0].order_ref,ORDER);assert.equal(member.orders[0].recordId,hq.records[0].case_ref);
   if(key){const receipt=f.sql.prepare('SELECT id,created_at FROM partner_audit WHERE entity_id=? AND action=? ORDER BY version LIMIT 1').get(ORDER,'fulfilment_'+action);const milestone=hq.records[0].milestones.find(x=>x.key===key);assert.equal(milestone.at,receipt.created_at);assert.equal(milestone.evidence_ref,receipt.id);if(action==='accept')assert.equal(member.careUpdates.find(x=>x.kind==='fulfilment_accept').at,receipt.created_at);else assert.equal(member.orders[0].timeline.find(x=>x.key===key).at,receipt.created_at);}
   if(action==='prepare')assert.equal(hq.records[0].milestones.find(x=>x.key==='dispensed').confirmed,false);
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,1);
 }finally{f.close();}
});

test('The synthetic RX cohort is visible in HQ without renaming native case/order references or admitting live payments or real email domains',async()=>{
 const {functionalDataset}=await import('../qa/functional-fixtures.mjs'),f=await functionalDataset('A');try{f.env.HQ_V3_TEST_MODE='true';let r=await f.hq('/partner-desk/operations');assert.equal(r.status,200);let hq=await r.json();assert.equal(hq.records[0].order_ref,f.order);assert.equal(hq.records[0].case_ref,RECORD);
  f.sql.prepare("UPDATE medicine_orders SET stripe_checkout_session_id='cs_live_NOT_A_TEST' WHERE id=1").run();assert.equal((await(await f.hq('/partner-desk/operations')).json()).records.length,0);f.sql.prepare("UPDATE medicine_orders SET stripe_checkout_session_id='cs_test_ONLY',email='person@deliverable.test' WHERE id=1").run();assert.equal((await(await f.hq('/partner-desk/operations')).json()).records.length,0);
 }finally{f.close();}
});
test('HQ uses the same information-request owner, due date and next action as the native RX workbench',async()=>{
 const {functionalDataset}=await import('../qa/functional-fixtures.mjs'),f=await functionalDataset('A');try{f.env.HQ_V3_TEST_MODE='true';const response=await f.call('/information',{version:0,assessmentVersion:1,message:'FICTIONAL new case A request',requestedFields:['medicines1Details'],dueAt:new Date(Date.now()+3600000).toISOString()});assert.equal(response.status,200,await response.clone().text());
  const native=await(await f.hq('/platform',1)).json(),hq=await(await f.hq('/partner-desk/operations',1)).json();assert.equal(hq.records[0].action.code,native.records[0].action.code);assert.equal(hq.records[0].action.dueAt,native.records[0].action.dueAt);assert.deepEqual(hq.records[0].action.owner,native.records[0].action.owner);assert.ok(!JSON.stringify(hq).includes('FICTIONAL new case A request'));
 }finally{f.close();}
});
test('The explicitly configured owner MFA exception works in Partner Desk but grants no clinical authority and fails closed when its exact binding changes',async()=>{
 const {PASSWORD_SIGNIN_LAST_DAY}=await import('../password-signin.mjs'),f=await setup();try{const id=152,token='FICTIONAL-OWNER-DESK-SESSION-ONLY';f.tokens[id]=token;Object.assign(f.env,{SSTRX_PASSWORD_SIGNIN_ENABLED:'true',SSTRX_PASSWORD_SIGNIN_UNTIL:PASSWORD_SIGNIN_LAST_DAY});const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');f.sql.prepare("INSERT INTO hq_users(id,email,name,password_hash,role,status,mfa_enabled) VALUES(152,'shiftsometimber@gmail.com','FICTIONAL OWNER TEST','!NOT-A-PASSWORD','owner','active',0)").run();f.sql.prepare('INSERT INTO hq_sessions(hq_user_id,token_hash,expires_at) VALUES(?,?,?)').run(id,hash,new Date(Date.now()+86400000).toISOString());
  const original=f.env.HQ_AUTH.fetch;f.env.HQ_AUTH.fetch=async request=>{const r=await original(request);if(r.ok&&new URL(request.url).pathname.endsWith('/me')){const b=await r.json(),u=f.sql.prepare('SELECT email,status FROM hq_users WHERE id=?').get(b.user.id);return Response.json({user:{...b.user,...u}});}return r;};
  let r=await f.hq('/partner-desk/operations',id);assert.equal(r.status,200,await r.clone().text());r=await f.hq('/partner-desk/assign',id,{recordId:RECORD,staffUserId:3,active:true});assert.equal(r.status,200,await r.clone().text());assert.equal((await f.hq('/'+RECORD+'/action',id,{action:'decision',outcome:'proceed'})).status,403);
  f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='false';assert.equal((await f.hq('/partner-desk/operations',id)).status,403);f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='true';f.sql.prepare("UPDATE hq_users SET email='ordinary@example.test' WHERE id=152").run();assert.equal((await f.hq('/partner-desk/operations',id)).status,403);
 }finally{f.close();}
});
