import {routeMyShiftExperience} from './my-shift-experience.mjs';
// One shared member shortcut: both native wrappers load this live web surface.
export function installMemberMessages(){
 if(document.getElementById('mt-secure-messages-script'))return;
 const marker=document.createElement('span');marker.id='mt-secure-messages-script';marker.hidden=true;document.body.append(marker);
 let alive=true,ready=true,unread=null,pending=false,generation=0;
 const clear=()=>document.getElementById('mt-secure-messages-link')?.remove();
 function mount(){
  if(!alive)return clear();
  const aliases={'#shop':'/member/life-back/shop','#grub':'/member/grub','#fit':'/member/fit','#support':'/member/dashboard?timber=support#today','#more':'/member/settings'};
  const legacyTarget=value=>{
   const u=new URL(value,location.origin);if(u.origin!==location.origin||u.searchParams.has('tools')||u.searchParams.has('timber'))return null;
   let path=u.pathname==='/member/dashboard'?aliases[u.hash]:({'/member/support':'/member/life-back/support','/member/more':'/member/settings','/member/messages':'/member/my-shift?view=messages'})[u.pathname];
   if(u.pathname==='/member/settings'&&u.searchParams.get('legacy-settings')!=='1'){
    if(u.hash==='#privacy')path='/member/settings?legacy-settings=1#healthConsentManager';
    if(u.hash==='#memberDetailsPanel'||u.hash==='#memberDeliveryPanel')path='/member/my-shift/profile'+u.hash;
   }
   if(!path)return null;const v=new URL(path,location.origin);for(const [k,x]of u.searchParams)if(!v.searchParams.has(k))v.searchParams.set(k,x);
   if(u.pathname!=='/member/dashboard'&&!v.hash)v.hash=u.hash;
   if(v.pathname==='/member/settings'&&v.hash==='#privacy'){v.searchParams.set('legacy-settings','1');v.hash='#healthConsentManager';}
   return v.pathname+v.search+v.hash;
  };
  for(const a of document.querySelectorAll('a[href]')){const target=legacyTarget(a.getAttribute('href'));if(target)a.setAttribute('href',target);}
  const target=legacyTarget(location.href);
  if(target&&document.body.hasAttribute('data-mt-native-shell')&&document.body.dataset.memberSession==='ready'){
   history.replaceState(history.state,'',target);window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));return;
  }
  // The retained app renders More locally. Its visible tab must use the
  // canonical account entry rather than the old built-in tools panel.
  for(const a of document.querySelectorAll('a[data-mt-shop-tab="more"]')){
   const u=new URL(a.getAttribute('href')||'',location.origin);
   if(u.origin===location.origin&&u.pathname==='/member/dashboard'&&u.searchParams.get('timber')==='stuff'&&!u.searchParams.has('tools'))a.setAttribute('href','/member/settings');
  }
  // Existing settings fragments must continue to open their original controls.
  for(const a of document.querySelectorAll('a[href*="/member/settings#"]')){
   const u=new URL(a.getAttribute('href')||'',location.origin);
   if(u.origin===location.origin&&u.pathname==='/member/settings'&&['#notifications','#prefWeight','#healthConsentManager','#deviceHealth','#food'].includes(u.hash)){u.searchParams.set('legacy-settings','1');a.setAttribute('href',u.pathname+u.search+u.hash);}
  }
  const native=!!(window.__SST_NATIVE_PRESENTATION__||window.webkit?.messageHandlers?.sstHealth||window.sstHealth);
  if(native){
   // The existing PWA script intentionally hides its web-push controls in a
   // native wrapper. Keep the app's shortcut useful without implying support.
   for(const a of document.querySelectorAll('a[href*="#notifications"]')){
    const walker=document.createTreeWalker(a,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){
     if(node.data==='Daily check-in reminder')node.data='Notifications and reminders';
     if(node.data==='Optional. No health details in the notification')node.data='See the options available in this app';
    }
   }
   const pwa=document.getElementById('pwaReminderSettings');
   if(pwa&&location.pathname==='/member/settings'&&!document.getElementById('notifications')){
    pwa.hidden=true;
    const section=document.createElement('section');section.id='notifications';section.className='mt-v7-card';section.dataset.nativeNotificationOptions='';
    const heading=document.createElement('h2');heading.textContent='Notifications and reminders';
    const copy=document.createElement('p');copy.textContent='Treatment reminders are managed in My treatment. Daily check-in notifications are not currently available inside this app.';
    const link=document.createElement('a');link.href='/member/treatment';link.textContent='Open My treatment';
    section.append(heading,copy,link);pwa.before(section);
   }
  }
  if(!ready)return clear();
  const header=document.querySelector('.mt-shop-brand');if(!header)return;
  let link=document.getElementById('mt-secure-messages-link');
  if(!link){link=document.createElement('a');link.id='mt-secure-messages-link';link.href='/member/my-shift?view=messages';link.style.cssText='color:#E7E3DA;background:#050505;border:1px solid #707762;border-radius:8px;padding:10px 12px;min-height:44px;display:inline-flex;align-items:center;font-size:14px;white-space:nowrap';header.append(link);}
  const label=unread?'Messages · '+unread+' unread':'Messages';
  if(link.textContent!==label)link.textContent=label;
  link.setAttribute('aria-label',unread===null?'Messages — unread status unavailable':label);
 }
 async function refresh(){
  if(!alive||pending||document.hidden)return;pending=true;const version=generation;
  try{
   const r=await fetch('/v1/member/my-shift?projection=message-count',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!alive||version!==generation)return;
   if(r.status===401||r.status===403){ready=false;clear();return;}
   if(!r.ok)throw Error('unavailable');const d=await r.json();if(!alive||version!==generation)return;if(!Number.isInteger(d.unread)||d.unread<0)throw Error('unread status unavailable');
   ready=true;unread=d.unread;mount();
  }catch{if(!alive||version!==generation)return;unread=null;const link=document.getElementById('mt-secure-messages-link');if(link){link.textContent='Messages';link.setAttribute('aria-label','Messages — unread status unavailable');}}
  finally{pending=false;}
 }
 const accountChanged=()=>{generation++;ready=false;unread=null;clear();};document.addEventListener('sst:account-changed',accountChanged);
 const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});
 const resume=e=>{if(e.persisted){window.removeEventListener('pageshow',resume);marker.remove();installMemberMessages();}};
 window.addEventListener('pageshow',resume);
 const timer=setInterval(refresh,60000);
 window.addEventListener('focus',refresh);window.addEventListener('hashchange',mount);window.addEventListener('popstate',mount);document.addEventListener('sstrx-message-change',refresh);
 window.addEventListener('pagehide',()=>{alive=false;ready=false;clear();observer.disconnect();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('hashchange',mount);window.removeEventListener('popstate',mount);document.removeEventListener('sstrx-message-change',refresh);document.removeEventListener('sst:account-changed',accountChanged);},{once:true});
 mount();refresh();
}
export const MEMBER_ENTRY_CLIENT='('+installMemberMessages.toString()+')();';
export function wrapMemberInboxNavigation(original){
 return {...original,async fetch(request,env,ctx){
  const candidate=await routeMyShiftExperience(request,env,ctx,original);if(candidate)return candidate;
  const response=await original.fetch(request,env,ctx),url=new URL(request.url);
  if(url.origin!=='https://shiftsometimber.co.uk'||!url.pathname.startsWith('/member/')||request.method!=='GET'||response.status!==200||!(response.headers.get('Content-Type')||'').includes('text/html'))return response;
  if(url.pathname==='/member/settings'&&url.searchParams.get('legacy-settings')==='1'&&url.searchParams.has('view-data'))return response;
  const before=await response.text(),directSettings=url.pathname==='/member/settings'&&url.searchParams.get('legacy-settings')==='1';
  if((!before.includes('data-mt-native-shell')&&!directSettings)||before.includes('/assets/clinical-records/member-entry.mjs')||!before.includes('</head>'))return new Response(before,response);
  const after=before.replace('</head>','<script type="module" src="/assets/clinical-records/member-entry.mjs"></script></head>');
  const headers=new Headers(response.headers);for(const key of ['Content-Length','Content-Encoding','ETag','Last-Modified'])headers.delete(key);
  headers.set('X-Shift-Member-Messages','20261105');
  return new Response(after,{status:response.status,statusText:response.statusText,headers});
 }};
}
