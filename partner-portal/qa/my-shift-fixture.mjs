// Synthetic accounts only. This fixture never calls a supplier, email or Stripe.
import {fixture,ORDER,RECORD} from '../test/fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import member from '../service/member-service.mjs';
import {authenticator} from '../test/authenticator.mjs';
import {reviewAndPropose} from '../test/workflow-helpers.mjs';
import portal from '../sstrx-worker.mjs';
export {ORDER,RECORD};
export async function myShiftFixture(){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_SECURE_MESSAGES_ENABLED:'true',MY_SHIFT_REDESIGN_ENABLED:'true'});await ensurePlatformSchema(f.env.DB);
 f.sql.exec("ALTER TABLE users ADD COLUMN created_at TEXT;CREATE TABLE support_tickets(id INTEGER PRIMARY KEY,reference TEXT UNIQUE,user_id INTEGER NOT NULL,subject TEXT NOT NULL,priority TEXT,status TEXT,body TEXT,assigned_hq_user_id INTEGER,created_at TEXT,updated_at TEXT,closed_at TEXT);");
 f.sql.prepare('UPDATE users SET first_name=?,last_name=?,email=?,created_at=? WHERE id=42').run('James','Example','james.my-shift@example.test','2026-09-01T10:00:00Z');
 f.sql.prepare("UPDATE clinical_member_versions SET answers_json=json_set(answers_json,'$.fullName','James Example','$.email','james.my-shift@example.test') WHERE record_id=?").run(RECORD);
 const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
 const otherToken='fictional-other-member-session-0000000000',secondToken='fictional-james-other-device-000000000000';
 f.sql.prepare('INSERT INTO users(id,email,first_name,last_name,created_at) VALUES(99,?,?,?,?)').run('ben.my-shift@example.test','Ben','Example','2026-09-02T10:00:00Z');f.sql.exec('INSERT INTO user_auth VALUES(99,1)');
 for(const [id,t]of [[99,otherToken],[42,secondToken]])f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').run(id,await sha(t),new Date(Date.now()+86400000).toISOString());
 const call=(path='/v1/member/my-shift',body,token=f.memberToken,headers={})=>member.fetch(new Request('https://shiftsometimber.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'sst_session='+token,Origin:'https://shiftsometimber.co.uk','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),f.env,{});
 return{...f,call,otherToken,secondToken};
}
export async function rxSession(f,username){
 const origin='https://sstrx.shiftsometimber.co.uk',h={Origin:origin,'CF-Connecting-IP':'203.0.113.72','Content-Type':'application/json'};Object.assign(f.portalEnv,{SSTRX_PORTAL_ENABLED:'true',MY_SHIFT_REDESIGN_ENABLED:'true'});
 const a=await portal.fetch(new Request(origin+'/api/login',{method:'POST',headers:h,body:JSON.stringify({username,password:'Synthetic-only-password-987'})}),f.portalEnv);if(!a.ok)throw Error('Synthetic Rx password stage failed');const pending=a.headers.getSetCookie()[0].split(';')[0];
 const b=await portal.fetch(new Request(origin+'/api/mfa',{method:'POST',headers:{...h,Cookie:pending},body:'{"code":"123456"}'}),f.portalEnv);if(!b.ok)throw Error('Synthetic Rx MFA stage failed');return b.headers.getSetCookie().find(s=>s.startsWith('__Host-shift_partner=')).split(';')[0];
}
export async function signedRxFixture(f){
 const origin='https://sstrx.shiftsometimber.co.uk';
 const call=async(path,cookie,body)=>{const r=await portal.fetch(new Request(origin+'/api/clinical'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'CF-Connecting-IP':'203.0.113.72',Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),f.portalEnv);const d=await r.json();if(!r.ok)throw Error('Synthetic Rx action '+r.status+' '+JSON.stringify(d));return d;};
 const c=await rxSession(f,'CLNTEST');const adapted={...f,login:async()=>c,partner:async(path,cookie,body)=>portal.fetch(new Request(origin+'/api/clinical'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'CF-Connecting-IP':'203.0.113.72',Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),f.portalEnv)};
 const {proposal}=await reviewAndPropose(adapted);const accepted=await f.member('/prescription/decision',{version:proposal.version,action:'accept',agreed:true});if(!accepted.ok)throw Error('Synthetic member agreement failed');
 const key=await authenticator({rpId:'sstrx.shiftsometimber.co.uk'}),registration=await call('/prescriptions/'+RECORD+'/keys/challenge',c,{}),created=await call('/prescriptions/'+RECORD+'/keys/register',c,{challengeId:registration.id,proof:await key.register(registration.challenge,origin)});
 const approve=await f.hq('/prescriptions/keys/'+created.keyId+'/approve',2,{version:0,expiresAt:new Date(Date.now()+86400000).toISOString(),verificationReference:'FICTIONAL independent test signing review'});if(!approve.ok)throw Error('Synthetic signing key approval failed');
 const challenge=await call('/prescriptions/'+RECORD+'/signing-challenge',c,{version:proposal.version+1,keyId:created.keyId});await call('/prescriptions/'+RECORD+'/sign',c,{version:proposal.version+1,challengeId:challenge.id,document:challenge.document,proof:await key.sign(challenge.challenge,origin)});
 return{clinician:c,pharmacy:await rxSession(f,'DSPTEST'),call};
}
export async function seedPastOrders(f){
 const now=new Date(Date.now()-45*86400000).toISOString();
 for(const [id,ref,supplier]of [[2,'SST-PAST-A','pharmacy-org'],[3,'SST-PAST-B','other-pharmacy']]){
  const record='10000000-0000-4000-8000-00000000000'+id;
  f.sql.prepare(`INSERT INTO medicine_orders(id,order_number,user_id,email,medicine_id,variant_id,medicine_name,strength_label,unit_price_pence,total_pence,currency,status,clinical_status,updated_at) VALUES(?,?,42,'james.my-shift@example.test',1,11,'Synthetic fixture','Synthetic',100,100,'GBP','paid','fulfilled',?)`).run(id,ref,now);
  f.sql.prepare("INSERT INTO clinical_member_records VALUES(?,42,?,1,'submitted','synthetic-history',1,?,?)").run(record,ref,now,now);
  const state={orderNumber:ref,memberId:42,partnerId:supplier,status:'delivered',version:1,updatedAt:now,area:'weight_management',prescriptionId:null,tracking:null};
  f.sql.prepare('INSERT INTO partner_fulfilment VALUES(?,?,42,1,?,?)').run(ref,supplier,JSON.stringify(state),now);
  f.sql.prepare("INSERT INTO partner_audit VALUES(?,'order',?,1,'SYNTHETIC','fulfilment_delivered','{}',?)").run(crypto.randomUUID(),ref,now);
 }
}
