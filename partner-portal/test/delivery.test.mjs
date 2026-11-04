import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryFromAssessment,requireDelivery} from '../service/fulfilment-delivery.mjs';
import {fixture,ORDER} from './fixture.mjs';
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
test('signed handover uses the member’s complete alternative delivery address',()=>{
 const delivery=deliveryFromAssessment({fullName:'TEST MEMBER',address:'TEST HOME',postcode:'AA1 1AA',deliveryAddress:'TEST DELIVERY',deliveryPostcode:'BB1 1BB'});
 assert.deepEqual(delivery,{name:'TEST MEMBER',address:'TEST DELIVERY',postcode:'BB1 1BB',source:'member_delivery_address'});
});
test('home address is used only when no alternative address was entered',()=>{
 assert.equal(deliveryFromAssessment({address:'TEST HOME',postcode:'AA1 1AA'}).source,'member_home_address');
 for(const answers of [{address:'TEST HOME',postcode:'AA1 1AA',deliveryAddress:'PARTIAL ALTERNATIVE'},{address:'TEST HOME',postcode:'AA1 1AA',deliveryPostcode:'BB1 1BB'},{address:'TEST HOME'}])assert.throws(()=>deliveryFromAssessment(answers),/confirmed_delivery_address_required/);
});
test('legacy fulfilment with no complete delivery cannot be dispatched',()=>{
 for(const value of [null,{}, {address:'TEST'}, {address:'TEST',postcode:'\n'}])assert.throws(()=>requireDelivery(value),/confirmed_delivery_address_required/);
});
test('native dispensing action holds an address-less legacy task before dispatch',async()=>{
 const f=await fixture();try{
  const review=await reviewAndPropose(f);await issue(f,review.cookie,review.proposal);const cookie=await f.login('DSPTEST');
  for(const [version,action]of [[0,'accept'],[1,'prepare']])assert.equal((await f.partner('/partners/fulfilment/'+ORDER+'/action',cookie,{version,action})).status,200);
  const row=f.sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(ORDER),state=JSON.parse(row.state_json);assert.equal(state.delivery.postcode,'AA1 1AA');delete state.delivery;
  f.sql.prepare('UPDATE partner_fulfilment SET state_json=? WHERE order_number=?').run(JSON.stringify(state),ORDER);
  const response=await f.partner('/partners/fulfilment/'+ORDER+'/action',cookie,{version:2,action:'dispatch',carrier:'dpd',trackingNumber:'12345678901234'});
  assert.equal(response.status,422);assert.equal((await response.json()).error,'confirmed_delivery_address_required');assert.equal(f.order().clinical_status,'dispensing');
 }finally{f.close();}
});
