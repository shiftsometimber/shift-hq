import memberService from '../service/member-service.mjs';
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,RECORD,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
const input=(message='Fictional private clinical question')=>({clientReference:crypto.randomUUID(),recordId:RECORD,channel:'clinical',message});
async function setup(){const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_SECURE_MESSAGES_ENABLED:'true'});await ensurePlatformSchema(f.env.DB);f.sql.prepare('INSERT INTO clinical_case_assignments VALUES(?,3,1,?)').run(RECORD,new Date(Date.now()+86400000).toISOString());return f;}
test('member and assigned clinician exchange private messages; HQ sees routing metadata only',async()=>{const f=await setup();try{
 const created=await f.member('/messages',input());assert.equal(created.status,201,await created.clone().text());const t=await created.json();
 const received=await f.hq('/platform/messages/'+t.id,3);assert.equal(received.status,200);assert.equal((await received.json()).messages[0].body,'Fictional private clinical question');
 const reply=await f.hq('/platform/messages/'+t.id,3,{version:1,...input('Fictional clinician reply')});assert.equal(reply.status,201,await reply.clone().text());
 const member=await f.member('/messages/'+t.id);assert.equal((await member.json()).messages.length,2);
 const oversight=await(await f.hq('/platform/messages',1)).json();assert.equal(oversight.metadataOnly,true);assert.equal(oversight.threads[0].status,'awaiting_member');assert(!JSON.stringify(oversight).includes('Fictional private clinical question'));
 assert.equal((await f.hq('/platform/messages/'+t.id,1)).status,403);assert.equal((await f.hq('/platform/messages/'+t.id,4)).status,404);
 const before=await(await f.member('/messages')).json();assert.equal(before.threads[0].unread,true);assert.equal((await f.member('/messages/'+t.id+'/read',{version:2})).status,201);assert.equal((await(await f.member('/messages')).json()).threads[0].unread,false);
 assert.equal((await f.member('/messages/'+t.id+'/read',{version:3})).status,422);
}finally{f.close()}});
test('duplicate submissions are idempotent, stale replies conflict, and changed content cannot reuse a reference',async()=>{const f=await setup();try{
 const b=input(),a=await(await f.member('/messages',b)).json();const duplicate=await f.member('/messages',b);assert.equal(duplicate.status,201);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_messages').get().n,1);
 assert.equal((await f.member('/messages',{...b,message:'Changed text'})).status,409);
 const r=await f.hq('/platform/messages/'+a.id,3,{...input('First clinician reply'),version:1});assert.equal(r.status,201);
 assert.equal((await f.member('/messages/'+a.id,{...input('Stale member reply'),version:1})).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_messages').get().n,2);
}finally{f.close()}});
test('cross-member, revoked, unassigned and other-organisation access cannot read or post content',async()=>{const f=await setup();try{
 const t=await(await f.member('/messages',input())).json();
 f.sql.prepare('UPDATE clinical_case_assignments SET active=0 WHERE record_id=?').run(RECORD);
 assert.equal((await f.hq('/platform/messages/'+t.id,3)).status,404);assert.equal((await f.hq('/platform/messages/'+t.id,3,{...input(),version:1})).status,404);
 f.sql.prepare('UPDATE clinical_member_records SET user_id=99 WHERE id=?').run(RECORD);assert.equal((await f.member('/messages/'+t.id)).status,404);
 f.sql.prepare('UPDATE user_sessions SET revoked_at=?').run(new Date().toISOString());assert.notEqual((await f.member('/messages')).status,200);
}finally{f.close()}});
test('message routing requires a real verified assigned team and cannot be used by HQ to make a clinical message',async()=>{const f=await setup();try{
 assert.equal((await f.hq('/platform/messages',1,input())).status,403);assert.equal((await f.member('/messages',{...input(),channel:'another-provider'})).status,422);
 f.sql.prepare('UPDATE clinical_case_assignments SET active=0').run();assert.equal((await f.member('/messages',input())).status,409);
 f.sql.prepare('UPDATE clinical_case_assignments SET active=1').run();f.sql.prepare('UPDATE clinical_member_records SET review_sharing=0').run();assert.equal((await f.member('/messages',input())).status,403);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_messages').get().n,0);
}finally{f.close()}});
test('email alert review contains exact recipients and a secure link; no message content or sending capability',async()=>{const f=await setup();try{
 const t=await(await f.member('/messages',input('FICTIONAL SENSITIVE CONTENT DO NOT EMAIL'))).json();await f.hq('/platform/messages/'+t.id,3,{...input('FICTIONAL PRIVATE CLINICIAN RESPONSE'),version:1});
 const r=await f.hq('/platform/message-alerts',1);assert.equal(r.status,200);const d=await r.json();assert.equal(d.notificationsSent,false);assert.equal(d.sendAvailable,false);assert(d.drafts.length>=4);
 for(const draft of d.drafts){assert(draft.to.length);assert.deepEqual(draft.cc,[]);assert.deepEqual(draft.attachments,[]);assert.equal(draft.approvalRequired,true);assert(!JSON.stringify(draft).includes('FICTIONAL'));assert(draft.body.includes('https://'));}
 assert.equal((await f.hq('/platform/message-alerts',3)).status,403);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='hq_comms_drafts'").get().n,0);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clinical_notification_events WHERE kind='secure_message'").get().n,1);
}finally{f.close()}});
test('existing HQ and Rx conversations still work and prepare content-free email alert intents in both directions',async()=>{const f=await setup();try{
 const created=await f.hq('/partner-desk/threads',3,{orderNumber:ORDER,subject:'FICTIONAL OPERATIONS SUBJECT',message:'Fictional operational question'});assert.equal(created.status,201,await created.clone().text());const t=await created.json();
 const reply=await f.hq('/partner-desk/threads/'+t.id+'/reply',1,{version:1,message:'Fictional HQ response'});assert.equal(reply.status,200,await reply.clone().text());
 const d=await(await f.hq('/platform/message-alerts',1)).json();assert.equal(d.drafts.length,2);assert(d.drafts.every(d=>d.source==='hq_partner_message'));assert(!JSON.stringify(d).includes('Fictional operational question'));
 assert.equal((await(await f.hq('/partner-desk/threads/'+t.id,3)).json()).messages.length,2);
}finally{f.close()}});
test('secure messaging is closed without its explicit flag and existing member client gains the secure inbox only when enabled',async()=>{const f=await setup();try{
 const asset=()=>memberService.fetch(new Request('https://my-timber.app/assets/clinical-records/client.mjs'),f.env,{});assert((await(await asset()).text()).includes('sstMountSecureMessages'));f.env.SSTRX_SECURE_MESSAGES_ENABLED='false';assert(!(await(await asset()).text()).includes('sstMountSecureMessages'));assert.equal((await f.member('/messages',input())).status,503);assert.equal((await f.hq('/platform/messages',3)).status,503);
}finally{f.close()}});

test('clinic and pharmacy organisation boundaries also apply to inbox content through the existing gateway',async()=>{const f=await setup();try{
 const first=await(await f.member('/messages',input())).json();
 const org=JSON.parse(f.sql.prepare("SELECT state_json FROM partner_organisations WHERE id='clinical-org'").get().state_json);org.id='second-clinic';f.sql.prepare('INSERT INTO partner_organisations VALUES(?,1,?,?)').run(org.id,JSON.stringify(org),new Date().toISOString());
 const staff=JSON.parse(f.sql.prepare("SELECT state_json FROM partner_staff WHERE hq_user_id=3").get().state_json);staff.orgId=org.id;f.sql.prepare('UPDATE partner_staff SET org_id=?,state_json=? WHERE hq_user_id=3').run(org.id,JSON.stringify(staff));
 assert.equal((await f.hq('/platform/messages/'+first.id,3)).status,404);assert.equal((await(await f.hq('/platform/messages',3)).json()).threads.length,0);
 staff.orgId='clinical-org';f.sql.prepare('UPDATE partner_staff SET org_id=?,state_json=? WHERE hq_user_id=3').run(staff.orgId,JSON.stringify(staff));
 const review=await reviewAndPropose(f);await issue(f,review.cookie,review.proposal);
 const pharmacy=await f.member('/messages',{...input('Fictional pharmacy-only message'),channel:'pharmacy'});assert.equal(pharmacy.status,201,await pharmacy.clone().text());const t=await pharmacy.json();
 assert.equal((await f.partner('/platform/messages/'+t.id,await f.login('DSPTEST'))).status,200);assert.equal((await f.partner('/platform/messages/'+t.id,await f.login('DSPOTHER'))).status,404);
}finally{f.close()}});
