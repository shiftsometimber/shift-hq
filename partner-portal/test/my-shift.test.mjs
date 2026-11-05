import test from 'node:test';
import assert from 'node:assert/strict';
import {myShiftFixture,seedPastOrders,ORDER,RECORD} from '../qa/my-shift-fixture.mjs';
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
import {orderTimeline} from '../platform/my-shift-data.mjs';
import {retainedProfileHTML,routeMyShiftExperience} from '../platform/my-shift-experience.mjs';
import {myShiftHTML} from '../platform/my-shift-ui.mjs';
import {myShiftSnapshot} from '../platform/my-shift-data.mjs';
import sstrx from '../sstrx-worker.mjs';
import fs from 'node:fs/promises';
const json=async(r,status=200)=>{const t=await r.text();assert.equal(r.status,status,t);return JSON.parse(t);};
test('MS-X3: read-only shared projection creates no tables, copies no profile and honours switch-off',async()=>{const f=await myShiftFixture();try{
 const before=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();const d=await json(await f.call());
 assert.equal(d.memberId,42);assert.equal(d.account.firstName,'James');assert.equal(d.orders[0].reference,ORDER);assert.equal(d.activeOrders,1);assert.equal(d.unread,0);assert.equal(d.orders[0].timeline.filter(t=>t.complete).length,1);assert.equal(d.orders[0].timeline[0].at,null,'Mutable order updated_at is not a payment timestamp');
 assert.deepEqual(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),before);assert(!JSON.stringify(d).includes('Synthetic medicine'));assert(!JSON.stringify(d).includes('Fictional sandbox clinical'));
 f.env.MY_SHIFT_REDESIGN_ENABLED='false';assert.equal((await f.call()).status,404);assert.equal((await f.call('/member/my-shift')).status,404);assert.equal((await f.call('/v1/member/secure-messages')).status,200,'Existing inbox stays available');
}finally{f.close();}});
test('MS-O1/O2/M2: actual native signature and pharmacy actions appear with original timestamps; preparing and expected delivery never imply completion',async()=>{const f=await myShiftFixture();try{
 const {cookie,proposal}=await reviewAndPropose(f);await issue(f,cookie,proposal);const pharmacy=await f.login('DSPTEST');
 let d=await json(await f.call());assert.equal(d.orders[0].timeline[1].complete,true);assert(d.careUpdates.some(e=>e.kind==='prescription_issued'));
 for(const [version,action]of [[0,'accept'],[1,'prepare']])await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version,action}));
 d=await json(await f.call());assert.equal(d.orders[0].timeline[2].complete,false);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:2,action:'dispensed'}));
 d=await json(await f.call());assert.equal(d.orders[0].timeline[2].complete,true);assert.equal(d.orders[0].timeline[2].at,f.sql.prepare("SELECT created_at FROM partner_audit WHERE entity_id=? AND action='fulfilment_dispensed'").get(ORDER).created_at);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:3,action:'dispensed'}),409);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:3,action:'dispatch',trackingUnavailable:true,noTrackingReason:'FICTIONAL untracked service; no shipment'}));
 d=await json(await f.call());assert.equal(d.orders[0].tracking,null);assert.equal(d.orders[0].timeline[3].complete,true);assert.equal(d.orders[0].timeline[4].complete,false);assert(d.careUpdates.some(e=>e.kind==='fulfilment_dispatch'));
 const row=f.sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(ORDER),state=JSON.parse(row.state_json);state.deliveryUpdate={kind:'expected',expectedAt:'2099-11-06T12:00:00Z'};f.sql.prepare('UPDATE partner_fulfilment SET state_json=? WHERE order_number=?').run(JSON.stringify(state),ORDER);assert.equal((await json(await f.call())).orders[0].timeline[4].complete,false);
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:4,action:'delivered',message:'FICTIONAL delivery confirmation; no parcel'}));d=await json(await f.call());assert.equal(d.activeOrders,0);assert(d.orders[0].timeline.every(s=>s.complete));assert.equal((await json(await f.hq('/partner-desk'))).orders[0].orderNumber,d.orders[0].reference);assert.equal((await json(await f.hq('/partner-desk'))).orders[0].sharedStatus,'fulfilled');
}finally{f.close();}});
test('MS-O2: native tracked dispatch remains unchanged, absence needs explicit reason and current stock, prescription and permission',async()=>{const f=await myShiftFixture();try{
 const {cookie,proposal}=await reviewAndPropose(f);await issue(f,cookie,proposal);const pharmacy=await f.login('DSPTEST');for(const [version,action]of [[0,'accept'],[1,'prepare']])await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version,action}));
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:2,action:'dispatch',trackingUnavailable:true}),422);
 f.env.MY_SHIFT_REDESIGN_ENABLED='false';await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:2,action:'dispensed'}),503);f.env.MY_SHIFT_REDESIGN_ENABLED='true';
 const other=await f.login('DSPOTHER');await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',other,{version:2,action:'dispensed'}),404);
 f.sql.prepare('UPDATE medicine_inventory SET stock_on_hand=0').run();await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:2,action:'dispensed'}),409);f.sql.prepare('UPDATE medicine_inventory SET stock_on_hand=20').run();
 await json(await f.partner('/partners/fulfilment/'+ORDER+'/action',pharmacy,{version:2,action:'dispatch',carrier:'dpd',trackingNumber:'12345678901234'}));const o=(await json(await f.call())).orders[0];assert.equal(o.tracking.number,'12345678901234');assert.equal(o.timeline[2].complete,false,'Dispatch does not manufacture a dispensing receipt');
}finally{f.close();}});
test('MS-H2/M1/X2: shared support replies, read state and idempotency; private clinical content stays out of HQ support',async()=>{const f=await myShiftFixture();try{
 const first={clientReference:crypto.randomUUID(),message:'FICTIONAL question about my delivery'};const t=await json(await f.call('/v1/member/my-shift/support',first));assert.equal((await json(await f.call('/v1/member/my-shift/support',first))).duplicate,true);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM support_tickets').get().n,1);
 await json(await f.hq('/platform/my-shift-support/'+t.reference,3,{clientReference:crypto.randomUUID(),version:1,message:'Unauthorised clinical role'}),403);
 await json(await f.hq('/platform/my-shift-support/'+t.reference,1,{clientReference:crypto.randomUUID(),version:1,message:'FICTIONAL SHIFT support response'}));
 assert.equal((await json(await f.call())).unread,1);assert.equal((await f.call('/v1/member/my-shift/support/'+t.reference,undefined,f.otherToken)).status,404);
 assert.equal((await f.call('/v1/member/my-shift/support',{clientReference:crypto.randomUUID(),message:'Fictional other member request',orderReference:ORDER},f.otherToken)).status,404);
 const read=await json(await f.call('/v1/member/my-shift/support/'+t.reference));assert.equal(read.messages[1].body,'FICTIONAL SHIFT support response');
 await json(await f.call('/v1/member/my-shift/support/'+t.reference+'/read',{version:2}));assert.equal((await json(await f.call())).unread,0);assert.equal((await json(await f.call('/v1/member/my-shift/support/'+t.reference))).updatedAt,read.updatedAt,'Reading must not manufacture a new support message timestamp');
 await json(await f.call('/v1/member/my-shift/support/'+t.reference,{clientReference:crypto.randomUUID(),version:1,message:'Stale synthetic reply'}),409);
 await json(await f.call('/v1/member/my-shift/support/'+t.reference,{clientReference:crypto.randomUUID(),version:2,message:'FICTIONAL member reply'}));assert.equal((await json(await f.hq('/platform/my-shift-support'))).tickets[0].messages.length,3);
 assert.equal(f.sql.prepare('SELECT assigned_hq_user_id FROM support_tickets WHERE reference=?').get(t.reference).assigned_hq_user_id,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE entity_type='support' AND entity_id=?").get(t.reference).n,4);assert(!JSON.stringify(f.sql.prepare("SELECT detail_json FROM rx_platform_audit WHERE entity_type='support'").all()).includes('FICTIONAL SHIFT support response'));
 f.sql.prepare('INSERT INTO clinical_case_assignments VALUES(?,3,1,?)').run(RECORD,new Date(Date.now()+86400000).toISOString());const privateThread=await json(await f.call('/v1/member/secure-messages',{clientReference:crypto.randomUUID(),recordId:RECORD,channel:'clinical',message:'FICTIONAL private clinical question'}),201);assert.equal((await json(await f.call())).unread,0,'A member’s own message is not unread incoming mail');
 await json(await f.hq('/platform/messages/'+privateThread.id,3,{clientReference:crypto.randomUUID(),version:1,message:'FICTIONAL private clinical response'}),201);assert.equal((await json(await f.call())).unread,1);assert(!JSON.stringify(await json(await f.hq('/platform/my-shift-support'))).includes('private clinical'));
 assert(!JSON.stringify(await json(await f.call(undefined,undefined,f.otherToken))).includes(ORDER));
}finally{f.close();}});
test('MS-A2/X2: current device sign-out, expiry, CSRF and verified identity boundaries',async()=>{const f=await myShiftFixture();try{
 assert.equal((await f.call(undefined,undefined,'missing')).status,401);assert.equal((await f.call(undefined,undefined,f.memberToken,{Origin:'https://evil.example'})).status,403);
 for(const path of ['/v1/member/my-shift','/v1/member/my-shift/support','/v1/member/secure-messages','/v1/member/care-card','/v1/member/clinical-records'])assert.equal((await f.call(path,undefined,f.otherToken,{'X-My-Timber-Expected-Account':'42'})).status,409,path+' changed-account boundary');
 const sessions=await json(await f.call('/v1/member/my-shift/sessions'));assert.equal(sessions.sessions.length,2);assert.equal(sessions.sessions.filter(s=>s.current).length,1);assert(!JSON.stringify(sessions).includes('token_hash'));
 await json(await f.call('/v1/member/my-shift/sign-out',{},f.memberToken,{Origin:'https://evil.example'}),403);await json(await f.call('/v1/member/my-shift/sign-out',{}));assert.equal((await f.call()).status,401);assert.equal((await f.call(undefined,undefined,f.secondToken)).status,200);assert.equal((await f.call(undefined,undefined,f.otherToken)).status,200);
 f.sql.prepare('UPDATE user_auth SET email_verified=0 WHERE user_id=42').run();assert.equal((await f.call(undefined,undefined,f.secondToken)).status,403);
}finally{f.close();}});
test('MS-P: shared read projection has a constant database query count at one and one hundred orders',async()=>{const f=await myShiftFixture();try{
 let calls=0;const env={...f.env,DB:{prepare(sql){calls++;return f.DB.prepare(sql);}}};await myShiftSnapshot(env,{id:42});const one=calls;
 for(let id=2;id<=102;id++)f.sql.prepare("INSERT INTO medicine_orders(id,order_number,user_id,email,medicine_id,variant_id,medicine_name,strength_label,unit_price_pence,total_pence,currency,status,clinical_status,updated_at) VALUES(?,?,42,'james.my-shift@example.test',1,11,'Synthetic','Synthetic',100,100,'GBP','paid','assessment_pending',?)").run(id,'SYNTHETIC-LOAD-'+id,new Date().toISOString());calls=0;const result=await myShiftSnapshot(env,{id:42});assert.equal(calls,one);assert(calls<=8);assert.equal(result.orders.length,100);assert.equal(result.hasMoreOrders,true);assert.equal(result.activeOrders,null,'A bounded result is not an exact total');
}finally{f.close();}});
test('MS-O3/X4: original historical pharmacy is retained and uncertain jobs do not imply delivery',async()=>{const f=await myShiftFixture();try{
 await seedPastOrders(f);let d=await json(await f.call());assert.equal(d.orders.filter(o=>!o.active).length,2);assert.equal(d.orders.find(o=>o.reference==='SST-PAST-A').supplier.id,'pharmacy-org');assert.equal(d.orders.find(o=>o.reference==='SST-PAST-B').supplier.id,'other-pharmacy');
 f.sql.prepare('INSERT INTO rx_supplier_contracts VALUES(?,?,?,1,?,?,?)').run('synthetic-contract','clinical-org','synthetic','approved','{}',new Date().toISOString());f.sql.prepare('INSERT INTO rx_order_routes VALUES(?,42,?,?,?,?,?,?,?, ?,?)').run(ORDER,'clinical-org','pharmacy-org','synthetic-contract',1,'weight_management','SYNTHETIC-RX','{}','synthetic-authority',new Date().toISOString());f.sql.prepare("INSERT INTO rx_integration_jobs VALUES(?,?,?,?,?,?,'uncertain',1,NULL,'timeout',NULL,?,?)").run('synthetic-job','synthetic-contract',ORDER,'prescription_submit','synthetic-key','synthetic-digest',new Date().toISOString(),new Date().toISOString());d=await json(await f.call());const current=d.orders.find(o=>o.reference===ORDER);assert.equal(current.uncertain.state,'uncertain');assert.equal(current.timeline[4].complete,false);assert.equal(d.orders.find(o=>o.reference==='SST-PAST-A').supplier.id,'pharmacy-org');
 f.sql.exec('DROP TABLE support_tickets');d=await json(await f.call());assert.equal(d.unread,null,'Unavailable support is not zero unread');
}finally{f.close();}});
test('MS-C2/native: retained canonical profile controls and native bridge stay off unless explicitly enabled',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/public-account-boundary.json',import.meta.url),'utf8'));const profile=retainedProfileHTML(fixture.html);assert(profile.includes('id="memberDetailsForm"'));assert(profile.includes('id="memberDeliveryPanel"'));assert(!profile.includes('id="ms-menu"'));assert(profile.includes('/assets/member-experience/member-details.mjs'));
 const original={fetch:async()=>new Response('original')},req=new Request('https://shiftsometimber.co.uk/member/settings');assert.equal(await routeMyShiftExperience(req,{},null,original),null);
 assert.equal((await routeMyShiftExperience(req,{MY_SHIFT_REDESIGN_ENABLED:'true'},null,original)).status,503);assert(!myShiftHTML().includes('ms-menu-toggle'));
});
test('Rx member entrance reuses canonical member identity; professional origin/session remains separate',async()=>{const f=await myShiftFixture();try{
 const env={...f.portalEnv,MY_SHIFT_REDESIGN_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true'};const home=await sstrx.fetch(new Request('https://sstrx.shiftsometimber.co.uk/'),env);assert((await home.text()).includes('Member sign-in'));
 const handoff=await sstrx.fetch(new Request('https://sstrx.shiftsometimber.co.uk/member-sign-in?returnTo=https://evil.example'),env);assert.equal(handoff.status,303);assert.equal(handoff.headers.get('Location'),'https://shiftsometimber.co.uk/member-login?returnTo=%2Fmember%2Fmy-shift');assert.equal(handoff.headers.get('Set-Cookie'),null);
}finally{f.close();}});
