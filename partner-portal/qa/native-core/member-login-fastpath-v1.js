// G5-012 bounded member-login fast path.
// Keeps the existing PBKDF2 work factor and lockout semantics; collapses successful
// post-password D1 mutations into one batch instead of three serial round trips.
const LOGIN_PATH='/v1/auth/login';
const PBKDF2_SCHEME='pbkdf2';
const REMEMBER_DAYS=90;
const STANDARD_HOURS=12;
const LOCK_AFTER=8;
const LOCK_MS=15*60*1000;

export async function fastMemberLogin(request,env){
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!==LOGIN_PATH)return null;
  let body;try{body=await request.json()}catch{return json({ok:false,error:'invalid_json'},400)}
  const email=String(body?.email||'').trim().toLowerCase(),password=String(body?.password||'');
  const row=await env.DB.prepare(`SELECT u.*,a.password_hash,a.email_verified,a.failed_login_attempts,a.locked_until FROM users u JOIN user_auth a ON a.user_id=u.id WHERE lower(u.email)=?`).bind(email).first();
  if(!row)return json({ok:false,error:'invalid_credentials'},401);
  if(row.locked_until&&new Date(row.locked_until).getTime()>Date.now())return json({ok:false,error:'temporarily_locked'},423);
  const valid=await verifyPassword(password,row.password_hash);
  if(!valid){
    const attempts=Number(row.failed_login_attempts||0)+1,now=new Date().toISOString();
    const lockedUntil=attempts>=LOCK_AFTER?new Date(Date.now()+LOCK_MS).toISOString():null;
    await env.DB.prepare('UPDATE user_auth SET failed_login_attempts=?,locked_until=?,updated_at=? WHERE user_id=? AND password_hash=?').bind(lockedUntil?0:attempts,lockedUntil,now,row.id,row.password_hash).run();
    return json({ok:false,error:'invalid_credentials'},401);
  }
  if(!Number(row.email_verified||0)){
    const now=new Date().toISOString();
    await env.DB.prepare('UPDATE user_auth SET failed_login_attempts=0,locked_until=NULL,updated_at=? WHERE user_id=?').bind(now,row.id).run();
    return json({ok:false,error:'email_verification_required',emailVerified:false,verificationRequired:true,message:'Verify your email address before signing in.'},403);
  }
  const rememberMe=body?.rememberMe===true,ttlMs=rememberMe?REMEMBER_DAYS*24*60*60*1000:STANDARD_HOURS*60*60*1000;
  const now=new Date().toISOString(),expires=new Date(Date.now()+ttlMs).toISOString();
  const token=randomToken(32),tokenHash=await sha256Hex(token),ip=request.headers.get('CF-Connecting-IP')||'',ipHash=ip?`sha256:${await sha256Hex(ip)}`:null;
  // Password/reset and verification can change while PBKDF2 is running. The
  // session itself is the conditional commit marker for all success effects.
  const committed=await env.DB.batch([
    env.DB.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at,last_used_at,created_at) SELECT ?,?,?,?,? FROM user_auth WHERE user_id=? AND password_hash=? AND email_verified=1 AND (locked_until IS NULL OR locked_until<=?)').bind(row.id,tokenHash,expires,now,now,row.id,row.password_hash,now),
    env.DB.prepare('UPDATE user_auth SET failed_login_attempts=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_sessions WHERE token_hash=?)').bind(now,now,row.id,tokenHash),
    env.DB.prepare('UPDATE member_status SET last_activity_at=?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_sessions WHERE token_hash=?)').bind(now,now,row.id,tokenHash),
    env.DB.prepare('INSERT INTO audit_log(user_id,action,entity_type,entity_id,metadata,ip_address,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user_sessions WHERE token_hash=?)').bind(row.id,'auth.login','user',String(row.id),'{}',ipHash,now,tokenHash)
  ]);
  if(Number(committed[0]?.meta?.changes)!==1)return json({ok:false,error:'invalid_credentials'},401);
  const response=json({ok:true,user:publicUser(row),emailVerified:true,remembered:rememberMe},200);clearLegacyHostCookie(response,request);response.headers.append('Set-Cookie',sessionCookie(token,expires,request,rememberMe));return response;
}

async function verifyPassword(password,stored){
  try{
    const [scheme,iter,saltB64,hashB64]=String(stored).split('$');if(scheme!==PBKDF2_SCHEME)return false;
    const iterations=Number(iter);if(!Number.isInteger(iterations)||iterations<100000)return false;
    const salt=fromBase64url(saltB64),expected=fromBase64url(hashB64);
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,expected.length*8);
    return constantTimeEqual(new Uint8Array(bits),expected);
  }catch{return false}
}
function constantTimeEqual(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0}
function publicUser(u){return{id:u.id,email:u.email,firstName:u.first_name,lastName:u.last_name,phone:u.phone,dateOfBirth:u.date_of_birth,postcode:u.postcode,createdAt:u.created_at}}
function sessionCookie(token,expires,request,rememberMe){const host=new URL(request.url).hostname,domain=host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk')?'; Domain=.shiftsometimber.co.uk':'';const persistence=rememberMe?`; Expires=${new Date(expires).toUTCString()}; Max-Age=${Math.max(0,Math.floor((Date.parse(expires)-Date.now())/1000))}`:'';return `sst_session=${encodeURIComponent(token)}; Path=/${domain}${persistence}; HttpOnly; Secure; SameSite=Lax`}
function clearLegacyHostCookie(response,request){const host=new URL(request.url).hostname;if(host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk'))response.headers.append('Set-Cookie','sst_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')}
function randomToken(bytes){const a=crypto.getRandomValues(new Uint8Array(bytes));return base64url(a)}
async function sha256Hex(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...hash].map(b=>b.toString(16).padStart(2,'0')).join('')}
function base64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromBase64url(s){const p=String(s).replace(/-/g,'+').replace(/_/g,'/');const bin=atob(p+'='.repeat((4-p.length%4)%4)),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}

