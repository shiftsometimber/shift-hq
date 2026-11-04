import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,RECORD,ORDER} from './fixture.mjs';
import {authenticator} from './authenticator.mjs';
import {medicineCommerceRoutes} from './core/medicine-commerce-v1.js';
const json=async(response,status=200)=>{const t=await response.text();assert.equal(response.status,status,t);return JSON.parse(t);};
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
test('one real SQLite order: HQ assignment → partner login/MFA → clinical review → member agreement → cryptographic signature → pharmacy → HQ and My Timber',async()=>{
 const f=await fixture();try{
  const {cookie,proposal}=await reviewAndPropose(f);assert.equal(proposal.orderNumber,ORDER);
  await issue(f,cookie,proposal);assert.equal(f.order().clinical_status,'sent_to_pharmacy');
  const pharmacy=await f.login('DSPTEST');
  const parallel=await Promise.all([f.partner('/partner-desk',pharmacy),f.partner('/partners/fulfilment',pharmacy)]);for(const response of parallel)assert.equal(response.status,200);
  const queue=await json(await f.partner('/partners/fulfilment',pharmacy));assert.equal(queue.orders[0].orderNumber,ORDER);
  const ask=await json(await f.partner('/partner-desk/threads',pharmacy,{orderNumber:ORDER,subject:'Order handover',priority:'normal',message:'Fictional question: please confirm the handover reference.'}),201);
  const desk=await json(await f.hq('/partner-desk'));assert.equal(desk.counts.awaitingHq,1);assert.equal(desk.threads[0].id,ask.id);
  const questions=await json(await f.hq('/partner-desk/questions'));assert.equal(questions.threads[0].order_number,ORDER);assert(!JSON.stringify(questions).includes('please confirm the handover reference'));
  await json(await f.partner('/partner-desk/questions',pharmacy),403);
  await json(await f.hq('/partner-desk/threads/'+ask.id+'/reply',1,{version:1,message:'Fictional HQ reply: the reference is attached to this order.'}));
  const conversation=await json(await f.partner('/partner-desk/threads/'+ask.id,pharmacy));assert.equal(conversation.messages[1].actor_kind,'hq');assert.equal(conversation.thread.order_number,ORDER);
  await json(await f.partner('/partner-desk/threads/'+ask.id+'/reply',pharmacy,{version:2,message:'Fictional partner reply returned to HQ.'}));
  assert.equal((await json(await f.hq('/partner-desk/counts'))).awaitingHq,1);
  for(const [action,status]of [['accept','pharmacy_received'],['prepare','dispensing'],['dispatch','dispatched'],['delivered','fulfilled']]){
   const current=await json(await f.partner('/partners/fulfilment/'+ORDER,pharmacy));
   await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:current.order.version,action,carrier:'dpd',trackingNumber:'12345678901234',message:'Fictional delivery confirmation, no real shipment.'}));
   assert.equal(f.order().clinical_status,status,action);
   const memberResponse=await medicineCommerceRoutes(new Request('https://api.shiftsometimber.co.uk/v1/treatment/orders',{headers:{Cookie:'sst_session='+f.memberToken}}),f.env,{});
   const member=await json(memberResponse);assert.equal(member.orders[0].orderNumber,ORDER);assert.equal(member.orders[0].clinicalStatus,status);assert(!JSON.stringify(member).includes('clinical-signature:'));assert(!JSON.stringify(member).includes('clinical-professional:'));
   const owner=await json(await f.hq('/partner-desk'));assert.equal(owner.orders[0].sharedStatus,status);
  }
  await json(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:false}));
  assert.equal((await json(await f.hq('/partner-desk'))).counts.unassigned,0,'Completed supply must not become an unassigned clinical review');
  const visible=await json(await f.member());assert(!JSON.stringify(visible).includes('Fictional sandbox decision only'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_prescription_events').get().n,6);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_workflow_sync WHERE status='pending'").get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clinical_notification_channels WHERE provider_reference IS NOT NULL").get().n,0);
 }finally{f.close();}
});
