import {routeMyShiftExperience} from './my-shift-experience.mjs';
// One shared member shortcut: both native wrappers load this live web surface.
export function installMemberMessages(){
 if(document.getElementById('mt-secure-messages-script'))return;
 const marker=document.createElement('span');marker.id='mt-secure-messages-script';marker.hidden=true;document.body.append(marker);
 let alive=true,ready=true,unread=null,pending=false;
 const clear=()=>document.getElementById('mt-secure-messages-link')?.remove();
 function mount(){
  if(!alive||!ready)return clear();
  // The retained app renders More locally. Its visible tab must use the
  // canonical account entry rather than the old built-in tools panel.
  for(const a of document.querySelectorAll('a[data-mt-shop-tab="more"]')){
   const u=new URL(a.getAttribute('href')||'',location.origin);
   if(u.origin===location.origin&&u.pathname==='/member/dashboard'&&u.searchParams.get('timber')==='stuff'&&!u.searchParams.has('tools'))a.setAttribute('href','/member/settings');
  }
  const header=document.querySelector('.mt-shop-brand');if(!header)return;
  let link=document.getElementById('mt-secure-messages-link');
  if(!link){link=document.createElement('a');link.id='mt-secure-messages-link';link.href='/member/messages';link.style.cssText='color:#E7E3DA;background:#050505;border:1px solid #707762;border-radius:8px;padding:10px 12px;min-height:44px;display:inline-flex;align-items:center;font-size:14px;white-space:nowrap';header.append(link);}
  const label=unread?'Messages · '+unread+' unread':'Messages';
  if(link.textContent!==label)link.textContent=label;
  link.setAttribute('aria-label',unread===null?'Messages — unread status unavailable':label);
 }
 async function refresh(){
  if(!alive||pending||document.hidden)return;pending=true;
  try{
   const r=await fetch('/v1/member/secure-messages',{credentials:'same-origin',cache:'no-store'});
   if(!alive)return;
   if(r.status===401||r.status===403){ready=false;clear();return;}
   if(!r.ok)throw Error('unavailable');const d=await r.json();if(!alive)return;
   ready=true;unread=d.threads.filter(t=>t.unread).length;mount();
  }catch{unread=null;const link=document.getElementById('mt-secure-messages-link');if(link){link.textContent='Messages';link.setAttribute('aria-label','Messages — unread status unavailable');}}
  finally{pending=false;}
 }
 const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});
 const resume=e=>{if(e.persisted){window.removeEventListener('pageshow',resume);marker.remove();installMemberMessages();}};
 window.addEventListener('pageshow',resume);
 const timer=setInterval(refresh,60000);
 window.addEventListener('focus',refresh);document.addEventListener('sstrx-message-change',refresh);
 window.addEventListener('pagehide',()=>{alive=false;ready=false;clear();observer.disconnect();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('sstrx-message-change',refresh);},{once:true});
 mount();refresh();
}
export const MEMBER_ENTRY_CLIENT='('+installMemberMessages.toString()+')();';
export function wrapMemberInboxNavigation(original){
 return {...original,async fetch(request,env,ctx){
  const candidate=await routeMyShiftExperience(request,env,ctx,original);if(candidate)return candidate;
  const response=await original.fetch(request,env,ctx),url=new URL(request.url);
  if(url.origin!=='https://shiftsometimber.co.uk'||!url.pathname.startsWith('/member/')||request.method!=='GET'||response.status!==200||!(response.headers.get('Content-Type')||'').includes('text/html'))return response;
  const before=await response.text();
  if(!before.includes('data-mt-native-shell')||before.includes('/assets/clinical-records/member-entry.mjs')||!before.includes('</head>'))return new Response(before,response);
  const after=before.replace('</head>','<script type="module" src="/assets/clinical-records/member-entry.mjs"></script></head>');
  const headers=new Headers(response.headers);for(const key of ['Content-Length','Content-Encoding','ETag','Last-Modified'])headers.delete(key);
  headers.set('X-Shift-Member-Messages','20261105');
  return new Response(after,{status:response.status,statusText:response.statusText,headers});
 }};
}
