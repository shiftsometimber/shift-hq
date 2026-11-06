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
