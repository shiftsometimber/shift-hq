import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,RECORD} from './fixture.mjs';
import member from '../service/member-service.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {wrapMemberInboxNavigation} from '../platform/member-entry.mjs';
async function setup(){const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_SECURE_MESSAGES_ENABLED:'true',CLINICAL_REVIEW_READY:'false'});await ensurePlatformSchema(f.env.DB);f.sql.prepare('INSERT INTO clinical_case_assignments VALUES(?,3,1,?)').run(RECORD,new Date(Date.now()+86400000).toISOString());return f;}
function call(f,path='/v1/member/secure-messages',body,options={}){return member.fetch(new Request('https://shiftsometimber.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://shiftsometimber.co.uk',Cookie:'sst_session='+f.memberToken,'Content-Type':'application/json',...options.headers},body:body===undefined?undefined:JSON.stringify(body)}),f.env,{});}
test('normal verified members can use the shared inbox with clinical commissioning still closed',async()=>{const f=await setup();try{
 const page=await call(f,'/member/messages');assert.equal(page.status,200);assert((await page.text()).includes('Your messages'));assert(page.headers.get('Cache-Control').includes('no-store'));assert(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
 const created=await call(f,undefined,{clientReference:crypto.randomUUID(),recordId:RECORD,channel:'clinical',message:'FICTIONAL member inbox test'});assert.equal(created.status,201,await created.clone().text());const thread=await created.json();
 const read=await f.hq('/platform/messages/'+thread.id,3);assert.equal((await read.json()).messages[0].body,'FICTIONAL member inbox test');
 await f.hq('/platform/messages/'+thread.id,3,{clientReference:crypto.randomUUID(),version:1,message:'FICTIONAL Rx reply'});
 const inbox=await(await call(f)).json();assert.equal(inbox.threads[0].unread,true);assert.equal(inbox.records[0].recordId,RECORD);assert(!JSON.stringify(inbox).includes('FICTIONAL Rx reply'));
 const opened=await(await call(f,'/v1/member/secure-messages/'+thread.id)).json();assert.equal(opened.messages.length,2);
 assert.equal((await call(f,'/v1/member/secure-messages/'+thread.id+'/read',{version:2})).status,201);
 assert.equal((await(await call(f)).json()).threads[0].unread,false);
 assert.equal((await call(f,'/v1/member/clinical-records')).status,403);assert.equal(f.env.CLINICAL_REVIEW_READY,'false');
}finally{f.close();}});
test('member shortcut wrapper preserves prior handlers and only appends to the shared native member shell',async()=>{
 const html='<!doctype html><html><head></head><body data-mt-native-shell>Retained member interface</body></html>';
 const scheduled=()=>{};
 const original={scheduled,fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html','ETag':'old','Cache-Control':'no-store'}})};
 const wrapped=wrapMemberInboxNavigation(original);assert.equal(wrapped.scheduled,scheduled);
 const r=await wrapped.fetch(new Request('https://shiftsometimber.co.uk/member/dashboard'),{},{});const s=await r.text();assert.equal(s.replace('<script type="module" src="/assets/clinical-records/member-entry.mjs"></script>',''),html);assert.equal(r.headers.get('ETag'),null);
 for(const url of ['https://shiftsometimber.co.uk/','https://hq.shiftsometimber.co.uk/member/dashboard'])assert.equal(await(await wrapped.fetch(new Request(url),{},{})).text(),html);
});
test('unverified, signed-out, revoked and wrong-origin inbox access is rejected',async()=>{const f=await setup();try{
 assert.equal((await call(f,undefined,undefined,{headers:{Cookie:''}})).status,401);
 assert.equal((await call(f,undefined,undefined,{headers:{Origin:'https://untrusted.example'}})).status,403);
 f.sql.prepare('UPDATE user_auth SET email_verified=0').run();assert.equal((await call(f)).status,403);
 f.sql.prepare('UPDATE user_auth SET email_verified=1').run();f.sql.prepare('UPDATE user_sessions SET revoked_at=?').run(new Date().toISOString());assert.equal((await call(f)).status,401);
}finally{f.close();}});
test('inbox cannot expose reassigned records, bypass care assignment, or activate clinical care',async()=>{const f=await setup();try{
 const body={clientReference:crypto.randomUUID(),recordId:RECORD,channel:'clinical',message:'Fictional privacy test'};
 const t=await(await call(f,undefined,body)).json();f.sql.prepare('UPDATE clinical_member_records SET user_id=99 WHERE id=?').run(RECORD);
 assert.equal((await(await call(f)).json()).threads.length,0);assert.equal((await call(f,'/v1/member/secure-messages/'+t.id)).status,404);
 assert.equal((await call(f,undefined,{...body,clientReference:crypto.randomUUID()})).status,404);
 f.sql.prepare('UPDATE clinical_member_records SET user_id=42 WHERE id=?').run(RECORD);f.sql.prepare('UPDATE clinical_case_assignments SET active=0').run();assert.equal((await call(f,undefined,{...body,clientReference:crypto.randomUUID(),channel:'pharmacy'})).status,409);
 f.env.SSTRX_SECURE_MESSAGES_ENABLED='false';assert.equal((await call(f)).status,503);
}finally{f.close();}});
