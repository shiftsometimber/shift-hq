import {passwordMeetsPolicy,PASSWORD_POLICY_MESSAGE} from './password-policy-v1.js';
import {registrationMetadata} from './acquisition-activation/model.mjs';
// G5-012 bounded member-registration fast path.
// Preserves the existing Core registration contract while removing avoidable
// sequential D1 round-trips. Returning null is a fail-safe handoff to the
// authoritative legacy Core register implementation.

export async function fastMemberRegister(request,env){
  const u=new URL(request.url),path=u.pathname.replace(/\/+$/,'')||'/';
  if(request.method!=='POST'||path!=='/v1/auth/register'||!env?.DB)return null;

  let body={};
  try{body=await request.clone().json()}catch{return json({ok:false,error:'invalid_registration',message:PASSWORD_POLICY_MESSAGE},400)}
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(!isEmail(email)||!passwordMeetsPolicy(password))return json({ok:false,error:'invalid_registration',message:PASSWORD_POLICY_MESSAGE},400);

  const firstName=clean(body.firstName,100),lastName=clean(body.lastName,100),phone=clean(body.phone,50),dateOfBirth=clean(body.dateOfBirth,20),postcode=clean(body.postcode,20),source=clean(body.source,100)||'website';
  const autoVerify=String(env.AUTO_VERIFY_EMAIL||'true').toLowerCase()==='true';
  const rememberMe=body?.rememberMe===true,ttlMs=rememberMe?90*24*60*60*1000:12*60*60*1000;
  const now=new Date().toISOString(),expires=new Date(Date.now()+ttlMs).toISOString();
  const token=randomToken(32),ip=request.headers.get('CF-Connecting-IP')||'';

  // CPU security work overlaps the one duplicate/orphan lookup. Password strength
  // and PBKDF2 cost remain identical to legacy Core.
  const passwordHashPromise=hashPassword(password),sessionHashPromise=sha256Hex(token),ipHashPromise=ip?sha256Hex(ip):Promise.resolve(null);

  try{
    let user=await env.DB.prepare(`SELECT u.*,a.user_id AS auth_user_id FROM users u LEFT JOIN user_auth a ON a.user_id=u.id WHERE lower(u.email)=?`).bind(email).first();
    if(user?.auth_user_id)return json({ok:false,error:'email_in_use',message:'An account already exists for that email. Please sign in.'},409);

    if(!user){
      const inserted=await env.DB.prepare(`INSERT INTO users(email,first_name,last_name,phone,date_of_birth,postcode) VALUES(?,?,?,?,?,?)`).bind(email,firstName,lastName,phone,dateOfBirth,postcode).run();
      const id=Number(inserted?.meta?.last_row_id||0);
      if(!id)throw new Error('fast_register_user_id_missing');
      user={id,email,first_name:firstName,last_name:lastName,phone,date_of_birth:dateOfBirth,postcode,created_at:now};
    }else{
      await env.DB.prepare(`UPDATE users SET first_name=COALESCE(?,first_name),last_name=COALESCE(?,last_name),phone=COALESCE(?,phone),date_of_birth=COALESCE(?,date_of_birth),postcode=COALESCE(?,postcode),updated_at=? WHERE id=?`).bind(firstName,lastName,phone,dateOfBirth,postcode,now,user.id).run();
      user={...user,first_name:firstName||user.first_name,last_name:lastName||user.last_name,phone:phone||user.phone,date_of_birth:dateOfBirth||user.date_of_birth,postcode:postcode||user.postcode};
    }

    const [passwordHash,sessionHash,ipHashRaw]=await Promise.all([passwordHashPromise,sessionHashPromise,ipHashPromise]);
    const ops=[
      env.DB.prepare(`INSERT INTO user_auth(user_id,password_hash,email_verified,email_verified_at) VALUES(?,?,?,?)`).bind(user.id,passwordHash,autoVerify?1:0,autoVerify?now:null),
      env.DB.prepare(`INSERT OR IGNORE INTO member_status(user_id,lifecycle_stage,membership_status,source,last_activity_at) VALUES(?,?,?,?,?)`).bind(user.id,'registered','none',source,now),
      env.DB.prepare(`INSERT OR IGNORE INTO member_state(user_id) VALUES(?)`).bind(user.id)
    ];
    if(Array.isArray(body.consents))for(const c of body.consents.slice(0,20))ops.push(env.DB.prepare(`INSERT INTO consents(user_id,consent_type,consent_version,granted,granted_at) VALUES(?,?,?,?,?)`).bind(user.id,clean(c?.type,80)||'unspecified',clean(c?.version,50),c?.granted?1:0,c?.granted?now:null));
    ops.push(
      env.DB.prepare(`INSERT INTO audit_log(user_id,action,entity_type,entity_id,metadata,ip_address,created_at) VALUES(?,?,?,?,?,?,?)`).bind(user.id,'auth.register','user',String(user.id),registrationMetadata(body,Date.parse(now)),ipHashRaw?`sha256:${ipHashRaw}`:null,now),
      env.DB.prepare(`INSERT INTO user_sessions(user_id,token_hash,expires_at,last_used_at,created_at) VALUES(?,?,?,?,?)`).bind(user.id,sessionHash,expires,now,now)
    );
    await env.DB.batch(ops);
    const response=json({ok:true,user:publicUser(user),emailVerified:autoVerify,remembered:rememberMe},201,{'X-Shift-Register-Path':'fast-v2'});clearLegacyHostCookie(response,request);response.headers.append('Set-Cookie',sessionCookie(token,expires,request,rememberMe));return response;
  }catch(e){
    console.warn('fast_member_register_fallback',String(e?.message||e).slice(0,240));
    return null;
  }
}

function publicUser(u){return{id:u.id,email:u.email,firstName:u.first_name,lastName:u.last_name,phone:u.phone,dateOfBirth:u.date_of_birth,postcode:u.postcode,createdAt:u.created_at}}
function clean(v,max=500){const s=String(v??'').trim();return s?s.slice(0,max):null}
function isEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}
function sessionCookie(token,expires,request,rememberMe){const host=new URL(request.url).hostname,domain=host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk')?'; Domain=.shiftsometimber.co.uk':'';const persistence=rememberMe?`; Expires=${new Date(expires).toUTCString()}; Max-Age=${Math.max(0,Math.floor((Date.parse(expires)-Date.now())/1000))}`:'';return `sst_session=${encodeURIComponent(token)}; Path=/${domain}${persistence}; HttpOnly; Secure; SameSite=Lax`}
function clearLegacyHostCookie(response,request){const host=new URL(request.url).hostname;if(host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk'))response.headers.append('Set-Cookie','sst_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')}
async function hashPassword(password){const iterations=100000,salt=crypto.getRandomValues(new Uint8Array(16)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256);return `pbkdf2$${iterations}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`}
async function sha256Hex(value){const data=new TextEncoder().encode(String(value)),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));return[...digest].map(b=>b.toString(16).padStart(2,'0')).join('')}
function randomToken(bytes=32){return base64url(crypto.getRandomValues(new Uint8Array(bytes)))}
function base64url(bytes){let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}

