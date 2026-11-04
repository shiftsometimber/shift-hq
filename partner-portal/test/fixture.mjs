import {database} from './database.mjs';
import {ensureSharedSchema} from '../service/schema.mjs';
import service from '../service/clinical-service.mjs';
import memberService from '../service/member-service.mjs';
import portal from '../worker.mjs';
import {careFields,careChecks,CARE_HANDOVER_VERSION} from '../service/clinical-kernel.mjs';
export const RECORD='10000000-0000-4000-8000-000000000001',ORDER='TEST-SHARED-1042';
const sha=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),b=>b.toString(16).padStart(2,'0')).join('');
export async function fixture(){
 const db=database(),{sql,DB}=db;await ensureSharedSchema(DB);const date=new Date().toISOString(),future=new Date(Date.now()+30*86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 sql.prepare('INSERT INTO users(id,email,first_name,last_name) VALUES(42,?,?,?)').run('fictional-member@example.test','Fictional','Member');sql.prepare('INSERT INTO user_auth VALUES(42,1)').run();
 const tokens={};
 for(const [id,role,name]of [[1,'owner','Fictional HQ owner'],[2,'owner','Fictional independent governor'],[3,'clinical','Fictional prescriber'],[4,'clinical','Fictional pharmacy'],[5,'clinical','Other pharmacy']]){
  tokens[id]='fictional-session-'+id+'-000000000000000000000000';sql.prepare('INSERT INTO hq_users(id,email,name,password_hash,role,status,mfa_enabled) VALUES(?,?,?,?,?,\'active\',1)').run(id,'fixture-'+id+'@example.test',name,'!fixture-no-real-password',role);
  sql.prepare('INSERT INTO hq_sessions(hq_user_id,token_hash,expires_at) VALUES(?,?,?)').run(id,await sha(tokens[id]),future);
 }
 const memberToken='fictional-member-session-0000000000000000';sql.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES(42,?,?)').run(await sha(memberToken),future);
 for(const [id,kind]of [['clinical-org','clinical'],['pharmacy-org','pharmacy'],['other-pharmacy','pharmacy']]){
  const org={id,kind,name:'Fictional '+id,status:'approved',version:1,expiresAt:future,premises:'Fictional practice address',registration:'SYNTHETIC-NOT-A-REAL-REGISTRATION'};sql.prepare('INSERT INTO partner_organisations VALUES(?,1,?,?)').run(id,JSON.stringify(org),date);
 }
 const checks=['identity','registration','indemnity','agreements','competence'].map(kind=>({kind,credentialVersion:1,outcome:'verified',expiresAt:future}));
 for(const [id,kind,org]of [[3,'clinician','clinical-org'],[4,'dispensing','pharmacy-org'],[5,'dispensing','other-pharmacy']]){
  const staff={id:'professional-'+id,hqUserId:id,username:id===3?'CLNTEST':id===4?'DSPTEST':'DSPOTHER',kind,orgId:org,status:'active',version:1,credentialVersion:1,details:{name:'Fictional professional '+id,email:'fixture-'+id+'@example.test',profession:'GP',regulator:'GMC',registrationNumber:'SYNTHETIC-'+id,prescribingEntitlement:'Fictional sandbox entitlement only'},evidence:[],checks,grants:[{credentialVersion:1,area:'weight_management',startsAt:past,expiresAt:future,medicines:[],actions:kind==='clinician'?['review','query','clinical_decision','issue_prescription']:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']}],passwordSetAt:date};
  sql.prepare('INSERT INTO partner_staff VALUES(?,?,?,?,?,1,?,?)').run(staff.id,id,staff.username,kind,org,JSON.stringify(staff),date);
 }
 for(const id of [2,3])sql.prepare("INSERT INTO clinical_hq_staff VALUES(?,'clinician',1,'FICTIONAL-SANDBOX','GMC',?,?)").run(id,'SYNTHETIC-'+id,future);
 sql.prepare("INSERT INTO medicine_products(id,name,active_ingredient,form,status,description,sellable,availability_state) VALUES(1,'Synthetic medicine','Synthetic','tablet','available','FICTIONAL TEST ONLY',1,'available')").run();
 sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(11,1,'Synthetic strength',100,'available',?,1,'available')").run(date);
 sql.prepare('INSERT INTO medicine_inventory VALUES(11,20,0,?)').run(date);
 sql.prepare("INSERT INTO medicine_orders(id,order_number,user_id,email,medicine_id,variant_id,medicine_name,strength_label,unit_price_pence,total_pence,currency,status,clinical_status,stripe_checkout_session_id,updated_at) VALUES(1,?,42,'fictional-member@example.test',1,11,'Synthetic medicine','Synthetic strength',100,100,'GBP','paid','assessment_pending','cs_live_SYNTHETIC_NOT_A_PAYMENT',?)").run(ORDER,date);
 const answers={fullName:'Fictional Member',dateOfBirth:'1980-01-01',address:'Fictional home address',postcode:'AA1 1AA',email:'fictional-member@example.test',phone:'FICTIONAL',heightCm:175,weightKg:100,gpPractice:'Fictional practice'};
 const evidence=[{id:'front-photo-fixture',kind:'front_photo',digest:'fictional-front-digest',mime:'image/png',uploadedAt:date},{id:'photo-id-fixture',kind:'photo_id',digest:'fictional-id-digest',mime:'image/png',uploadedAt:date}];
 sql.prepare("INSERT INTO clinical_member_records VALUES(?,42,?,1,'submitted','shift-compact-v5-draft-2026-10-23',1,?,?)").run(RECORD,ORDER,date,date);
 sql.prepare("INSERT INTO clinical_member_versions VALUES(?,1,'shift-compact-v5-draft-2026-10-23',?,?,?,'immutable-fictional-assessment',1,?)").run(RECORD,JSON.stringify(answers),JSON.stringify(evidence),JSON.stringify({truth:true}),date);
 for(const e of evidence)sql.prepare('INSERT INTO clinical_member_evidence VALUES(?,?,?,?,?,?,?,?)').run(e.id,RECORD,'fictional/'+e.id,e.kind,e.mime,1,e.digest,date);
 sql.prepare("INSERT INTO clinical_case_state VALUES(?,0,'awaiting_review',1,?)").run(RECORD,date);
 const challenges=new Map(),authCalls=[];
 const auth={async fetch(request){authCalls.push(request.url);const path=new URL(request.url).pathname;
  if(path.endsWith('/auth/login')){const b=await request.json(),u=sql.prepare('SELECT * FROM hq_users WHERE email=?').get(b.email);if(!u||b.password!=='Synthetic-only-password-987')return Response.json({error:'invalid_credentials'},{status:401});const challenge=crypto.randomUUID();challenges.set(challenge,u.id);return Response.json({mfaRequired:true,challenge});}
  if(path.endsWith('/auth/mfa/verify')){const b=await request.json(),id=challenges.get(b.challenge);if(!id||b.code!=='123456')return Response.json({error:'invalid_mfa'},{status:401});challenges.delete(b.challenge);return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session='+tokens[id]+'; Path=/; Secure; Max-Age=3600'}});}
  const token=(request.headers.get('Cookie')||'').match(/sst_hq_session=([^;]+)/)?.[1],hash=token?await sha(token):'';const u=sql.prepare('SELECT u.* FROM hq_users u JOIN hq_sessions s ON s.hq_user_id=u.id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status=\'active\'').get(hash,new Date().toISOString());
  if(!u)return Response.json({error:'sign_in_required'},{status:401});
  if(path.endsWith('/auth/logout')){sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE token_hash=?').run(new Date().toISOString(),hash);return Response.json({ok:true});}
  return Response.json({user:{id:u.id,name:u.name,role:u.role,mfaEnabled:u.mfa_enabled===1}});
 }};
 const files={async get(){return {body:new Uint8Array([0]),httpMetadata:{contentType:'image/png'}}}};
 const env={DB,HQ_AUTH:auth,CLINICAL_PRIVATE_FILES:files,PARTNER_PRIVATE_FILES:files,PARTNER_OPERATIONS_ENABLED:'true',PARTNER_INTERNAL_SETUP_ONLY:'false',PARTNER_LOGIN_ENABLED:'true',PARTNER_FULFILMENT_ENABLED:'true',CLINICAL_CASEWORK_ENABLED:'true',CLINICAL_REVIEW_READY:'true',CLINICAL_CONTEXT_ENABLED:'false',PRESCRIPTION_WORKFLOW_ENABLED:'true',PRESCRIPTION_SIGNING_ENABLED:'true',PRESCRIPTION_SIGNATURE_POLICY_REFERENCE:'FICTIONAL-LOCAL-TEST-NOT-A-CLINICAL-APPROVAL',PARTNER_CLINICAL_APPROVER_IDS:'2',SHARED_ORDER_WORKFLOW_ENABLED:'true',CLINICAL_MEMBER_RECORDS_ENABLED:'true',NOTIFICATION_EVENTS_ENABLED:'true',PARTNER_NOTIFICATION_REVIEW_ENABLED:'true',PARTNER_TRACKING_READ_ENABLED:'true',PARTNER_MEMBER_REPLIES_ENABLED:'true'};
 const portalEnv={PARTNER_ACCESS_ENABLED:'true',PORTAL_SESSION_KEY:'ab'.repeat(32),HQ_AUTH:auth,CLINICAL:{fetch:r=>service.fetch(r,env,{waitUntil(){}})}};
 const hq=(path,id=1,body)=>service.fetch(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:'sst_hq_session='+tokens[id],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(){}});
 const member=(path='',body)=>memberService.fetch(new Request('https://api.shiftsometimber.co.uk/v1/member/clinical-records/'+RECORD+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://shiftsometimber.co.uk',Cookie:'sst_session='+memberToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,{});
 async function login(username){const start=await portal.fetch(new Request('https://partner.shiftsometimber.co.uk/api/login',{method:'POST',headers:{Origin:'https://partner.shiftsometimber.co.uk','CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json'},body:JSON.stringify({username,password:'Synthetic-only-password-987'})}),portalEnv);if(!start.ok)throw Error('Login '+start.status+' '+await start.text());const pending=start.headers.get('Set-Cookie').split(';')[0];const end=await portal.fetch(new Request('https://partner.shiftsometimber.co.uk/api/mfa',{method:'POST',headers:{Origin:'https://partner.shiftsometimber.co.uk','CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json',Cookie:pending},body:'{"code":"123456"}'}),portalEnv);if(!end.ok)throw Error('MFA '+end.status+' '+await end.text());return end.headers.getSetCookie().find(x=>x.startsWith('__Host-shift_partner=')).split(';')[0];}
 const partner=(path,cookie,body)=>portal.fetch(new Request('https://partner.shiftsometimber.co.uk/api/clinical'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://partner.shiftsometimber.co.uk',Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),portalEnv);
 const handover={version:CARE_HANDOVER_VERSION};for(const [id,,type]of careFields)handover[id]=Array.isArray(type)?type[0]:type==='date'?new Date(Date.now()+(id==='followUpDate'?7:0)*86400000).toISOString().slice(0,10):'Fictional sandbox clinical handover';for(const [id]of careChecks)handover[id]=true;
 return {...db,env,portalEnv,hq,member,login,partner,tokens,memberToken,handover,authCalls,order:()=>sql.prepare('SELECT * FROM medicine_orders WHERE id=1').get()};
}
