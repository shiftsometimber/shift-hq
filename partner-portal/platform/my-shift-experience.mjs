// Candidate bridge on the EXISTING member route owner. The service binding points
// to shift-clinical-records, never a new backend or a new authentication system.
const ORIGIN='https://shiftsometimber.co.uk';
const privateHeaders={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
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
 const page=['/member/settings','/member/my-shift','/member/my-shift/'].includes(u.pathname),profile=u.pathname==='/member/my-shift/profile';
 const retained=u.pathname==='/assets/member-experience/v7-retained-script.mjs'&&u.searchParams.get('source')==='/assets/clinical-records/my-shift.mjs';
 if(!page&&!profile&&!retained)return null;
 if(!env.MY_SHIFT_MEMBER?.fetch)return new Response('Your account view is temporarily unavailable.',{status:503,headers:privateHeaders});
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
