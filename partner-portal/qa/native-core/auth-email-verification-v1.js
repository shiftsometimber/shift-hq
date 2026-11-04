import {acquisitionRoutes,acquisitionAccountDelete} from './acquisition-activation/server.mjs';
import {recordAuthDelivery} from './auth-delivery-v1.js';
import {queueSignupAlert} from './member-signup-alert.mjs';

const VERIFY_TTL_MS=24*60*60*1000;
const DEFAULT_FROM='hello@shiftsometimber.co.uk';
const DEFAULT_SITE='https://shiftsometimber.co.uk';

export async function handleEmailVerification(request,env,ctx,next){
  const u=new URL(request.url),p=u.pathname.replace(/\/+$/,'')||'/';
  const acquisition=await acquisitionRoutes(request,env);if(acquisition)return acquisition;
  const deletion=await acquisitionAccountDelete(request,env,ctx,next);if(deletion)return deletion;
  if(request.method==='POST'&&p==='/v1/auth/register')return registerWithVerification(request,env,ctx,next);
  if(request.method==='POST'&&p==='/v1/auth/login')return loginWithVerification(request,env,ctx,next);
  if((request.method==='GET'||request.method==='POST')&&p==='/v1/auth/verify-email')return verifyEmail(request,env);
  if(request.method==='POST'&&p==='/v1/auth/resend-verification')return resendVerification(request,env);
  return null;
}

async function registerWithVerification(request,env,ctx,next){
  const clone=request.clone();let supplied={};try{supplied=await clone.json()}catch{}
  const response=await next(request,env,ctx);
  if(!response.ok)return response;
  let data={};try{data=await response.clone().json()}catch{return response}
  if(response.status===201&&data.ok===true)await queueSignupAlert(env,Number(data?.user?.id||0),ctx);
  if(data.emailVerified!==false)return response;

  const userId=Number(data?.user?.id||0),email=String(data?.user?.email||supplied.email||'').trim().toLowerCase();
  if(!userId||!isEmail(email))return response;

  const stamp=new Date().toISOString();
  await env.DB.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(stamp,userId).run();
  const delivery=await issueVerification(env,{userId,email,firstName:data?.user?.firstName||data?.user?.first_name||supplied.firstName},new URL(request.url).origin);
  await recordAudit(env.DB,userId,'auth.email_verification_required',{delivery});

  const headers=new Headers(response.headers);headers.set('Set-Cookie',clearSessionCookie(request));appendLegacyHostCookieClear(headers,request);headers.set('Cache-Control','no-store');
  return new Response(JSON.stringify({...data,emailVerified:false,verificationRequired:true,verificationDelivery:delivery,message:delivery==='sent'?'Check your email and verify your address before signing in.':'Your account was created, but we could not send the verification email. Please request a fresh link or contact support.'}),{status:response.status,headers:{...Object.fromEntries(headers),'Content-Type':'application/json; charset=utf-8'}});
}

async function loginWithVerification(request,env,ctx,next){
  const response=await next(request,env,ctx);
  if(!response.ok)return response;
  let data={};try{data=await response.clone().json()}catch{return response}
  if(data.emailVerified!==false)return response;
  const userId=Number(data?.user?.id||0),stamp=new Date().toISOString();
  if(userId)await env.DB.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(stamp,userId).run();
  const headers=new Headers(response.headers);headers.set('Set-Cookie',clearSessionCookie(request));appendLegacyHostCookieClear(headers,request);headers.set('Cache-Control','no-store');headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(JSON.stringify({ok:false,error:'email_verification_required',emailVerified:false,verificationRequired:true,message:'Verify your email address before signing in.'}),{status:403,headers});
}

async function verifyEmail(request,env){
  const u=new URL(request.url);let token='';
  if(request.method==='GET')token=String(u.searchParams.get('token')||'').trim();
  else{const b=await readJson(request);token=String(b.token||'').trim()}
  if(!token)return verificationFailure(request,env,'verification_missing','That verification link is incomplete.');

  const tokenHash=await sha256Hex(token);
  const row=await env.DB.prepare(`SELECT t.id,t.user_id,t.expires_at,t.used_at,u.email,u.first_name,a.email_verified FROM auth_tokens t JOIN users u ON u.id=t.user_id JOIN user_auth a ON a.user_id=t.user_id WHERE t.token_hash=? AND t.token_type='email_verification' AND a.password_hash NOT LIKE 'closed$%' ORDER BY t.id DESC LIMIT 1`).bind(tokenHash).first();
  if(!row||row.used_at||new Date(row.expires_at).getTime()<=Date.now())return verificationFailure(request,env,'verification_expired','That verification link has expired or has already been used.');

  const stamp=new Date().toISOString();
  const committed=await env.DB.batch([
    env.DB.prepare("UPDATE user_auth SET email_verified=1,email_verified_at=?,updated_at=? WHERE user_id=? AND password_hash NOT LIKE 'closed$%' AND EXISTS(SELECT 1 FROM auth_tokens WHERE id=? AND used_at IS NULL AND julianday(expires_at)>julianday('now'))").bind(stamp,stamp,row.user_id,row.id),
    env.DB.prepare('UPDATE auth_tokens SET used_at=? WHERE id=? AND changes()=1').bind(stamp,row.id),
    env.DB.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND token_type='email_verification' AND used_at IS NULL AND id<>?").bind(stamp,row.user_id,row.id)
  ]);
  if(Number(committed[0]?.meta?.changes)!==1)return verificationFailure(request,env,'verification_expired','That verification link has expired or has already been used.');
  await recordAudit(env.DB,row.user_id,'auth.email_verified',{});
  await sendWelcome(env,{id:row.user_id,email:row.email,firstName:row.first_name});

  if(request.method==='GET')return Response.redirect(`${siteUrl(env)}/member-login.html?verified=1`,302);
  return json({ok:true,emailVerified:true,message:'Email verified. You can sign in now.'});
}

async function resendVerification(request,env){
  const b=await readJson(request),email=String(b.email||'').trim().toLowerCase();
  const generic={ok:true,message:'If that account still needs verification, a fresh link will be sent shortly.'};
  if(!isEmail(email))return json(generic);
  const row=await env.DB.prepare('SELECT u.id,u.email,u.first_name,a.email_verified FROM users u JOIN user_auth a ON a.user_id=u.id WHERE lower(u.email)=? AND a.password_hash NOT LIKE \'closed$%\'').bind(email).first();
  if(row&&!Number(row.email_verified||0)){
    const delivery=await issueVerification(env,{userId:row.id,email:row.email,firstName:row.first_name},new URL(request.url).origin);
    await recordAudit(env.DB,row.id,'auth.email_verification_resent',{delivery});
  }
  return json(generic);
}

async function issueVerification(env,user,apiOrigin){
  const stamp=new Date().toISOString(),token=randomToken(32),tokenHash=await sha256Hex(token),expiresAt=new Date(Date.now()+VERIFY_TTL_MS).toISOString();
  await env.DB.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND token_type='email_verification' AND used_at IS NULL").bind(stamp,user.userId).run();
  await env.DB.prepare('INSERT INTO auth_tokens(user_id,token_hash,token_type,expires_at) VALUES(?,?,?,?)').bind(user.userId,tokenHash,'email_verification',expiresAt).run();
  if(!env.EMAIL){await recordAuthDelivery(env.DB,{userId:user.userId,email:user.email,eventType:'email_verification',status:'binding_missing'});return'binding_missing'}
  const verifyUrl=`${String(apiOrigin||'https://api.shiftsometimber.co.uk').replace(/\/$/,'')}/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
  try{
    const result=await env.EMAIL.send({from:{email:String(env.AUTH_EMAIL_FROM||DEFAULT_FROM),name:'Shift Some Timber'},to:user.email,replyTo:'support@shiftsometimber.co.uk',subject:'Verify your My Timber email',html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1 style="color:#173c29">Verify your email</h1><p>Hi ${escapeHtml(user.firstName||'there')},</p><p>One quick check before you sign in to My Timber.</p><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#173c29;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:bold">Verify my email</a></p><p>This link expires in 24 hours. If you did not create a Shift account, ignore this email.</p><p>Shift Some Timber</p></div>`,text:`Verify your My Timber email: ${verifyUrl}\n\nThis link expires in 24 hours.`});
    await recordAuthDelivery(env.DB,{userId:user.userId,email:user.email,eventType:'email_verification',status:'sent',providerId:result?.id||result?.messageId||null});return'sent';
  }catch(e){await recordAuthDelivery(env.DB,{userId:user.userId,email:user.email,eventType:'email_verification',status:'failed',errorCode:cleanError(e)});console.error('auth_verification_email_failed',cleanError(e));return'failed'}
}

async function sendWelcome(env,user){
  if(!env.EMAIL||!user?.email)return;
  try{
    const result=await env.EMAIL.send({from:{email:String(env.AUTH_EMAIL_FROM||DEFAULT_FROM),name:'Shift Some Timber'},to:user.email,replyTo:'support@shiftsometimber.co.uk',subject:'Welcome to My Timber',html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1 style="color:#173c29">Welcome to My Timber</h1><p>Hi ${escapeHtml(user.firstName||'there')},</p><p>Your email is verified and your Shift account is ready.</p><p><a href="${siteUrl(env)}/member-login.html" style="display:inline-block;background:#173c29;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:bold">Open My Timber</a></p><p>Helping ordinary blokes feel like themselves again.</p></div>`,text:`Welcome to My Timber. Your email is verified and your account is ready: ${siteUrl(env)}/member-login.html`});
    await recordAuthDelivery(env.DB,{userId:user.id,email:user.email,eventType:'welcome',status:'sent',providerId:result?.id||result?.messageId||null});
  }catch(e){await recordAuthDelivery(env.DB,{userId:user.id,email:user.email,eventType:'welcome',status:'failed',errorCode:cleanError(e)});console.error('welcome_email_failed',cleanError(e))}
}

function verificationFailure(request,env,error,message){if(request.method==='GET')return Response.redirect(`${siteUrl(env)}/member-login.html?verification=${encodeURIComponent(error)}`,302);return json({ok:false,error,message},400)}
function clearSessionCookie(request){const host=new URL(request.url).hostname,domain=host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk')?'; Domain=.shiftsometimber.co.uk':'';return `sst_session=; Path=/${domain}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`}
function appendLegacyHostCookieClear(headers,request){const host=new URL(request.url).hostname;if(host==='shiftsometimber.co.uk'||host.endsWith('.shiftsometimber.co.uk'))headers.append('Set-Cookie','sst_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')}
async function recordAudit(DB,userId,action,metadata){try{await DB.prepare('INSERT INTO audit_log(user_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').bind(userId,action,'user',String(userId),JSON.stringify(metadata||{})).run()}catch(e){console.warn('auth_verification_audit_warning',e?.message)}}
function siteUrl(env){return String(env.PUBLIC_SITE_URL||DEFAULT_SITE).replace(/\/$/,'')}
function isEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))}
async function readJson(r){try{return await r.json()}catch{return{}}}
function json(d,s=200){return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function sha256Hex(value){const data=new TextEncoder().encode(String(value)),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));return[...digest].map(b=>b.toString(16).padStart(2,'0')).join('')}
function randomToken(bytes=32){return base64url(crypto.getRandomValues(new Uint8Array(bytes)))}
function base64url(bytes){let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cleanError(e){return String(e?.code||e?.name||e?.message||'delivery_error').replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,120)}

