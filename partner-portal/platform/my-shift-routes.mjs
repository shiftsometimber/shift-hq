import {authenticate,sessionHash} from '../service/member-kernel.mjs';
import {myShiftSnapshot} from './my-shift-data.mjs';
import {memberSupport} from './my-shift-support.mjs';
import {myShiftHTML,MY_SHIFT_CSS,myShiftClient} from './my-shift-ui.mjs';
import {SECURE_MESSAGE_CLIENT} from './messages-ui.mjs';
import {fail} from './domain.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {ensureSharedSchema} from '../service/schema.mjs';
import {passwordSettingsRuntime} from './vendor/core-password-settings-20261105.mjs';
const base='/v1/member/my-shift',assets='/assets/clinical-records/my-shift',origins=new Set(['https://shiftsometimber.co.uk','https://www.shiftsometimber.co.uk','https://my-timber.app']);
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow,noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
export const MY_SHIFT_CLIENT=SECURE_MESSAGE_CLIENT+'\n('+myShiftClient.toString()+')();';
export async function myShiftRoutes(request,env){
 const u=new URL(request.url),path=u.pathname,page=['/member/my-shift','/member/my-shift/','/member/messages','/member/care'].includes(path);
 const password=path==='/assets/clinical-records/member-password-settings.mjs';
 if(!page&&path!==base&&!path.startsWith(base+'/')&&!path.startsWith(assets)&&!password)return null;
 if(env.MY_SHIFT_REDESIGN_ENABLED!=='true')return null;
 const json=(b,s=200)=>Response.json(b,{status:s,headers});
 try{
  if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed');
  if(password&&request.method==='GET')return new Response(passwordSettingsRuntime,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path===assets+'.css'&&request.method==='GET')return new Response(MY_SHIFT_CSS,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
  if(path===assets+'.mjs'&&request.method==='GET')return new Response(MY_SHIFT_CLIENT,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  const origin=request.headers.get('Origin');if(origin&&!origins.has(origin)||request.method==='POST'&&!origins.has(origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_not_allowed');
  const a=await authenticate(request,env);if(page&&(!a||Number(a.email_verified)!==1))return new Response('<!doctype html><html lang="en-GB"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · My Timber</title><link rel="stylesheet" href="/assets/clinical-records/my-shift.css"></head><body><main id="my-shift"><h1>Your account is private</h1><p>Sign in to your verified My Timber account to continue.</p><a class="mx-action" href="/member-login?returnTo=%2Fmember%2Fmy-shift">Sign in to My Timber</a></main></body></html>',{status:a?403:401,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
  if(!a)fail(401,'sign_in_required');if(Number(a.email_verified)!==1)fail(403,'verified_account_required');
  const expected=request.headers.get('X-My-Timber-Expected-Account');if(expected&&expected!==String(a.id))fail(409,'account_changed');
  if(page){if(request.method!=='GET')fail(405,'method_not_allowed');return new Response(myShiftHTML({view:u.searchParams.get('view')||(path==='/member/messages'?'messages':path==='/member/care'?'care':'hub'),order:u.searchParams.get('order')||''}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});}
  if(env.SSTRX_PLATFORM_ENABLED!=='true')fail(503,'care_platform_unavailable');await ensureSharedSchema(env.DB);await ensurePlatformSchema(env.DB);
  if(path===base&&request.method==='GET'){const result=await myShiftSnapshot(env,a);await sessionHash(request,env,a.id);return json({...result,sessionExpiresAt:a.expires_at});}
  if(path===base+'/support'||path.startsWith(base+'/support/'))return json(await memberSupport(request,env,a,path.slice((base+'/support').length).split('/').filter(Boolean)));
  if(path===base+'/sessions'&&request.method==='GET'){const hash=await sessionHash(request,env,a.id),{results=[]}=await env.DB.prepare('SELECT token_hash,expires_at FROM user_sessions WHERE user_id=? AND revoked_at IS NULL AND julianday(expires_at)>julianday(?) ORDER BY expires_at DESC LIMIT 50').bind(a.id,new Date().toISOString()).all();return json({sessions:results.map(s=>({current:s.token_hash===hash,expiresAt:s.expires_at}))});}
  if(path===base+'/sign-out'&&request.method==='POST'){const hash=await sessionHash(request,env,a.id);await env.DB.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND token_hash=? AND revoked_at IS NULL').bind(new Date().toISOString(),a.id,hash).run();return Response.json({signedOut:true,currentSessionOnly:true},{headers:{...headers,'Set-Cookie':'sst_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});}
  fail(404,'not_found');
 }catch(e){return json({error:e.status?e.message:'my_shift_unavailable'},e.status||503);}
}
