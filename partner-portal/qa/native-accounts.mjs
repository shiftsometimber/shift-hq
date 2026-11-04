import fs from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import core,{ensureSchema} from './native-core/auth-kernel.mjs';
import {handleEmailVerification} from './native-core/email-kernel.mjs';
import {fastMemberRegister} from './native-core/member-register-fastpath-v2.js';
import {database} from '../test/database.mjs';
const json=async(r,status=200)=>{const body=await r.json();if(r.status!==status)throw Error('Native route '+r.status+' '+JSON.stringify(body));return body;};
export function totp(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=h[h.length-1]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
export async function nativeAccounts(){
 const db=database(),{DB,sql}=db;sql.exec('DROP TABLE user_sessions;DROP TABLE user_auth;DROP TABLE users;');sql.exec(await fs.readFile(new URL('./native-core/preview/bootstrap.sql',import.meta.url),'utf8'));await ensureSchema(DB);
 const mailbox=[],secrets=new Map(),ctx={waitUntil(p){p.catch(()=>{})}},env={DB,AUTO_VERIFY_EMAIL:'false',HQ_MFA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),ADMIN_API_KEY:randomBytes(32).toString('hex'),EMAIL:{async send(message){mailbox.push(message);return{id:'local-capture-'+mailbox.length}}}};
 const nativeFetch=async request=>{const next=async(r,e,c)=>(await fastMemberRegister(r,e))||core.fetch(r,e,c);return await handleEmailVerification(request,env,ctx,next)||next(request,env,ctx);};
 const api=async(path,body,cookie='',admin=false)=>nativeFetch(new Request('https://api.shiftsometimber.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:cookie,'Content-Type':'application/json',...(admin?{'x-shift-admin-key':env.ADMIN_API_KEY}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
 const memberEmail='full-loop-member-20261104@example.test',memberPassword=randomBytes(24).toString('base64url')+'aA7!';
 const registration=await json(await api('/v1/auth/register',{email:memberEmail,password:memberPassword,firstName:'TEST Full Loop',lastName:'Member',dateOfBirth:'1980-01-01',postcode:'TEST ONLY'}),201);
 const verification=mailbox.find(m=>m.subject==='Verify your My Timber email')?.text.match(/token=([^\s]+)/)?.[1];if(!verification)throw Error('Native verification email was not captured');
 await json(await api('/v1/auth/verify-email',{token:decodeURIComponent(verification)}));
 const login=await api('/v1/auth/login',{email:memberEmail,password:memberPassword});const memberSession=login.headers.getSetCookie().find(s=>/^sst_session=[^;]/.test(s)).split(';')[0];await json(login);
 const password=randomBytes(24).toString('base64url')+'aA7!',email='full-loop-owner-20261104@example.test';await json(await api('/v1/hq/auth/bootstrap',{email,name:'TEST Full Loop HQ Owner',password},'',true),201);
 const first=await api('/v1/hq/auth/login',{email,password});await json(first);let ownerSession=first.headers.getSetCookie().find(s=>s.startsWith('sst_hq_session=')).split(';')[0];
 const setup=await json(await api('/v1/hq/mfa/setup',{},ownerSession));await json(await api('/v1/hq/mfa/enable',{code:totp(setup.secret)},ownerSession));
 const challenge=await json(await api('/v1/hq/auth/login',{email,password}));if(!challenge.mfaRequired)throw Error('Native MFA challenge absent');
 const confirmed=await api('/v1/hq/auth/mfa/verify',{challenge:challenge.challenge,code:totp(setup.secret)});await json(confirmed);ownerSession=confirmed.headers.getSetCookie().find(s=>s.startsWith('sst_hq_session=')).split(';')[0];
 const owner=await json(await api('/v1/hq/me',undefined,ownerSession));if(!owner.user.mfaEnabled)throw Error('Native MFA state absent');
 secrets.set('member',{email:memberEmail,password:memberPassword});secrets.set('owner',{email,password,totpSecret:setup.secret});
 const actors={owner:{user:owner.user,session:ownerSession}};
 for(const [kind,role] of [['governor','owner'],['clinician','clinical'],['dispenser','clinical']]){
  const email='full-loop-'+kind+'-20261104@example.test',password=randomBytes(24).toString('base64url')+'aA7!';
  await json(await api('/v1/hq/users',{email,password,name:'TEST Full Loop '+kind,role},ownerSession),201);
  const first=await api('/v1/hq/auth/login',{email,password});await json(first);let session=first.headers.getSetCookie().find(s=>s.startsWith('sst_hq_session=')).split(';')[0];
  const setup=await json(await api('/v1/hq/mfa/setup',{},session));await json(await api('/v1/hq/mfa/enable',{code:totp(setup.secret)},session));
  const challenge=await json(await api('/v1/hq/auth/login',{email,password}));if(!challenge.mfaRequired)throw Error('Native '+kind+' MFA challenge absent');
  const verified=await api('/v1/hq/auth/mfa/verify',{challenge:challenge.challenge,code:totp(setup.secret)});await json(verified);session=verified.headers.getSetCookie().find(s=>s.startsWith('sst_hq_session=')).split(';')[0];
  const who=await json(await api('/v1/hq/me',undefined,session));actors[kind]={user:who.user,session};secrets.set(kind,{email,password,totpSecret:setup.secret});
 }
 return {...db,env,api,nativeFetch,secrets,actors,memberSession,ownerSession,member:registration.user,owner:owner.user,mailbox,summary:{memberEmail,memberId:registration.user.id,ownerId:owner.user.id,emailVerified:true,nativeMfaVerified:true,actors:Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,{id:a.user.id,role:a.user.role,mfaEnabled:a.user.mfaEnabled}])),outboundMessages:0,capturedMessages:mailbox.length}};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){const s=await nativeAccounts();console.log(JSON.stringify(s.summary));s.close();}
