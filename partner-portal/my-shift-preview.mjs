// Temporary release preview on the EXISTING member Workers. Selection uses
// hashes of genuine Core-issued fictional sessions; it never creates a session.
const ORIGIN='https://shiftsometimber.co.uk';
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const encoder=new TextEncoder();
function config(env,now){
 if(env.MY_SHIFT_PREVIEW_ENABLED!=='true'||!/^[a-f0-9]{40}$/.test(env.MY_SHIFT_PREVIEW_RELEASE||'')||!(Date.parse(env.MY_SHIFT_PREVIEW_UNTIL)>now))return null;
 try{const sessions=JSON.parse(env.MY_SHIFT_PREVIEW_SESSIONS);if(!Array.isArray(sessions)||!sessions.length||sessions.length>6||sessions.some(s=>!Number.isSafeInteger(s.memberId)||s.memberId<=0||!Number.isFinite(Date.parse(s.expiresAt))||!/^[a-f0-9]{64}$/.test(s.tokenHash)))return null;return sessions;}catch{return null;}
}
export async function previewSelection(request,env,now=Date.now()){
 const sessions=config(env,now);if(!sessions)return null;
 // Select only the first native cookie; never let a second stale cookie move a
 // different signed-in account into the preview. Native auth rechecks below.
 const raw=request.headers.get('Cookie')?.match(/(?:^|;\s*)sst_session=([^;]+)/)?.[1];if(!raw)return null;
 let token;try{token=decodeURIComponent(raw);}catch{return null;}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 return sessions.find(s=>s.tokenHash===hash&&Date.parse(s.expiresAt)>now)||null;
}
function eligible(url,method){
 if(url.origin!==ORIGIN||!['GET','POST','HEAD'].includes(method))return false;
 const p=url.pathname;if(/^\/v1\/member\/my-shift(?:\/|$)/.test(p))return true;
 if(!['GET','HEAD'].includes(method))return false;
 return /^\/member\/(?:my-shift(?:\/|$)|settings$|messages$|care$|dashboard$)/.test(p)||/^\/assets\/clinical-records\/(?:my-shift\.(?:css|mjs)|member-password-settings\.mjs|member-entry\.mjs)$/.test(p)||p==='/assets/member-experience/v7-retained-script.mjs'&&url.searchParams.get('source')==='/assets/clinical-records/my-shift.mjs';
}
export function createMyShiftPreview(original,candidate,{authenticate,authorize}={}){
 async function admitted(request,env,selected){
  if(authorize)return authorize(request,env,selected);
  if(!authenticate)return false;
  const actor=await authenticate(request,env);
  if(!actor||actor.id!==selected.memberId||Number(actor.email_verified)!==1||!/^myshift-pr40-[a-z0-9-]+@example\.test$/.test(actor.email))return false;
  return !!await env.DB.prepare("SELECT 1 ok FROM member_status WHERE user_id=? AND source='synthetic-acceptance-pr40-20261105'").bind(actor.id).first();
 }
 return{async fetch(request,env,ctx){
  const u=new URL(request.url),identity=u.origin===ORIGIN&&u.pathname==='/v1/member/my-shift/preview-identity';
  if(!identity&&!eligible(u,request.method))return original.fetch(request,env,ctx);
  const selected=await previewSelection(request,env);
  if(identity&&authenticate){if(request.method!=='GET')return json({error:'method_not_allowed'},405);if(request.headers.get('Origin')&&request.headers.get('Origin')!==ORIGIN)return json({error:'same_origin_required'},403);return selected&&await admitted(request,env,selected)?json({eligible:true,memberId:selected.memberId,authenticationChanged:false}):json({eligible:false},403);}
  if(!selected||!await admitted(request,env,selected))return original.fetch(request,env,ctx);
  // Exact CI candidate module, original request, native cookies and the existing
  // bindings. All normal accounts execute the captured baseline module.
  return candidate.fetch(request,{...env,MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_RELEASE:env.MY_SHIFT_PREVIEW_RELEASE},ctx);
 }};
}
