// Candidate bridge on the EXISTING member route owner. The service binding points
// to shift-clinical-records, never a new backend or a new authentication system.
const ORIGIN='https://shiftsometimber.co.uk';
const privateHeaders={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
export function retainedSecurityHTML(){
 // The canonical Core password-settings component supplies the handler and
 // Turnstile-protected reset. Only its existing form is placed in this shell.
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Password · My Timber</title><link rel="stylesheet" href="/assets/clinical-records/my-shift.css"><script defer src="/api-adapter-v33d.js"></script><script defer src="/turnstile-auth-v1.js?v=timeout-20260912"></script><script defer src="/assets/clinical-records/member-password-settings.mjs"></script><style>html,body{background:#050505;margin:0}</style></head><body><div id="my-shift"><header class="ms-top">MY TIMBER</header><main class="mx-wrap mx-detail-width"><a class="mx-back" href="/member/my-shift?view=account">‹ Account</a><h1>Password</h1><div class="mx-card" data-member-password-settings><p>We'll email a secure reset link to the email address on your My Timber account. The link expires after 30 minutes.</p><h2 id="member-password-heading">Reset your password</h2><form id="memberPasswordReset" aria-labelledby="member-password-heading" tabindex="-1"><button class="mx-action" type="submit" aria-describedby="memberPasswordStatus">Reset password</button><p id="memberPasswordStatus" role="status" aria-live="polite"></p><a href="/member-login" id="memberPasswordSignIn" hidden>Sign in again</a></form></div></main></div></body></html>`;
}
export function retainedProfileHTML(original){
 const start='<section class="ms-panel" data-panel="profile" hidden>',end='<section class="ms-panel" data-panel="health" hidden>';
 const a=original.indexOf(start),b=original.indexOf(end,a+start.length);
 if(a<0||b<0||original.indexOf(start,a+1)>=0)throw Error('Existing member profile boundary changed');
 const profile=original.slice(a+start.length,b).replace(/<\/section>\s*$/,'');
 if(!profile.includes('id="memberDetailsForm"')||!profile.includes('id="memberDeliveryPanel"'))throw Error('Existing profile and delivery controls required');
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Your details · My Timber</title><link rel="stylesheet" href="/assets/clinical-records/my-shift.css"><link rel="stylesheet" href="/assets/member-experience/member-details.css"><script defer src="/assets/member-experience/member-details.mjs"></script><style>html,body{background:#050505;margin:0}#my-shift #memberDetailsPanel{color:#050505}#my-shift .mx-profile a{color:inherit}</style></head><body><div id="my-shift"><header class="ms-top">MY TIMBER</header><main class="mx-wrap mx-detail-width mx-profile"><a class="mx-back" href="/member/my-shift?view=account">‹ Account</a>${profile}</main></div></body></html>`;
}
export async function routeMyShiftExperience(request,env,ctx,original){
 if(env.MY_SHIFT_REDESIGN_ENABLED!=='true')return null;
 const u=new URL(request.url);if(u.origin!==ORIGIN||request.method!=='GET')return null;
 const page=['/member/settings','/member/my-shift','/member/my-shift/'].includes(u.pathname),profile=u.pathname==='/member/my-shift/profile',security=u.pathname==='/member/my-shift/security';
 const retained=u.pathname==='/assets/member-experience/v7-retained-script.mjs'&&u.searchParams.get('source')==='/assets/clinical-records/my-shift.mjs';
 if(!page&&!profile&&!retained&&!security)return null;
 if(!env.MY_SHIFT_MEMBER?.fetch)return new Response('Your account view is temporarily unavailable.',{status:503,headers:privateHeaders});
 if(security)return new Response(retainedSecurityHTML(),{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.shiftsometimber.co.uk https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
 if(profile){
  const r=await original.fetch(new Request(ORIGIN+'/member/my-shift',request),env,ctx);if(!r.ok)return r;
  try{return new Response(retainedProfileHTML(await r.text()),{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8'}});}catch{return new Response('Your existing profile could not be opened. Please try again.',{status:503,headers:privateHeaders});}
 }
 const target=retained?'/assets/clinical-records/my-shift.mjs':'/member/my-shift'+u.search;
 const r=await env.MY_SHIFT_MEMBER.fetch(new Request(ORIGIN+target,request));
 if(!retained||!r.ok)return r;
 const context=u.searchParams.get('context');if(!/^[A-Za-z0-9_-]{1,100}$/.test(context||''))return new Response('Invalid retained context',{status:400,headers:privateHeaders});
 const code=await r.text();
 return new Response('(()=>{const ctx=window.MT_RETAINED_CONTEXT('+JSON.stringify(context)+');if(!ctx)return;(function(document,window,fetch,location){'+code+'\n})(ctx.document,ctx.window,ctx.fetch,ctx.location);})();',{headers:{...privateHeaders,'Content-Type':'text/javascript; charset=utf-8'}});
}
