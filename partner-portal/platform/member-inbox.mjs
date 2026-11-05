import {memberCareCard,MEMBER_CARE_CARD_CLIENT} from './care-card.mjs';
import {MEMBER_ENTRY_CLIENT} from './member-entry.mjs';
import {authenticate,sessionHash} from '../service/member-kernel.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {readObject,fail} from './domain.mjs';
import {listConversations,readConversation,sendSecureMessage,markConversationRead} from './messages.mjs';
import {SECURE_MESSAGE_CLIENT} from './messages-ui.mjs';

const origins=new Set(['https://shiftsometimber.co.uk','https://www.shiftsometimber.co.uk','https://my-timber.app']);
const base='/v1/member/secure-messages';
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
export const MEMBER_INBOX_CLIENT=SECURE_MESSAGE_CLIENT+MEMBER_CARE_CARD_CLIENT+`
const host=document.getElementById('secure-inbox');
let current=true,records=[];
window.addEventListener('pagehide',()=>{current=false;host.replaceChildren();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
sstMountSecureMessages(host,{member:true,inbox:true,url:'${base}',current:()=>current,records:()=>records,onList:d=>{records=d.records||[];}});
`;
export const MEMBER_INBOX_HTML=`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#050505"><meta name="robots" content="noindex,nofollow"><title>Messages · My Timber</title><link rel="stylesheet" href="/assets/clinical-records/style.css"><style>body{background:#050505;color:#E7E3DA}header{padding:16px;text-align:left}main{background:#E7E3DA;color:#050505;min-height:75vh;border-radius:16px 16px 0 0}header nav{display:flex;justify-content:space-between;align-items:center}header a{font-size:18px}button{touch-action:manipulation}#secure-inbox>div>button{display:block;width:100%;text-align:left}#secure-inbox form{margin-top:24px}main a{color:#3c4830}h1{font-size:28px}</style><script type="module" src="/assets/clinical-records/member-inbox.mjs"></script></head><body><header><nav aria-label="My Timber"><a href="/member/dashboard#today">MY TIMBER</a><a href="/member/dashboard#today">Back to Today</a></nav></header><main><h1>Your care &amp; messages</h1><section id="member-care-card" aria-live="polite"></section><section id="secure-inbox" aria-live="polite"></section><p>Need help with your account or order? <a href="/member/dashboard?timber=support#today">Contact SHIFT support</a>.</p><p>For urgent medical help, use the urgent-help guidance in My Timber. This inbox is not an emergency service.</p></main></body></html>`;

export async function memberInbox(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/assets/clinical-records/member-entry.mjs')return new Response(MEMBER_ENTRY_CLIENT,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 if(path==='/assets/clinical-records/member-inbox.mjs')return env.SSTRX_SECURE_MESSAGES_ENABLED==='true'?new Response(MEMBER_INBOX_CLIENT,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}}):new Response('Not found',{status:404,headers});
 const page=['/member/messages','/member/messages/','/member/care','/member/care/'].includes(path),card=path==='/v1/member/care-card';
 if(!page&&!card&&path!==base&&!path.startsWith(base+'/'))return null;
 const origin=request.headers.get('Origin');
 const reply=(body,status=200)=>Response.json(body,{status,headers:{...headers,...origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'}:{}}});
 try{
  if(env.SSTRX_PLATFORM_ENABLED!=='true'||env.SSTRX_SECURE_MESSAGES_ENABLED!=='true')fail(503,'secure_messages_not_open');
  if(origin&&!origins.has(origin)||request.method==='POST'&&!origins.has(origin))fail(403,'origin_not_allowed');
  if(!['GET','POST'].includes(request.method)||(page||card)&&request.method!=='GET')fail(405,'method_not_allowed');
  const actor=await authenticate(request,env);if(!actor){if(page)return new Response('<!doctype html><html lang="en-GB"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · My Timber</title><h1>Your messages are private</h1><p><a href="/member/login">Sign in to My Timber</a> to read and reply.</p></html>',{status:401,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});fail(401,'sign_in_required');}
  if(Number(actor.email_verified)!==1)fail(403,'verified_account_required');
  const expected=request.headers.get('X-My-Timber-Expected-Account');if(expected&&expected!==String(actor.id))fail(409,'account_changed');
  if(page)return new Response(MEMBER_INBOX_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
  await ensurePlatformSchema(env.DB);
  if(card)return reply(await memberCareCard(env,actor));
  const a={member:true,id:actor.id,sessionHash:await sessionHash(request,env,actor.id)};
  const parts=path.slice(base.length).split('/').filter(Boolean);
  if(parts.length>2||parts[1]&&parts[1]!=='read'||parts[0]&&!/^[a-f0-9-]{36}$/i.test(parts[0]))fail(404,'conversation_not_found');
  if(request.method==='GET'){
   if(parts[1])fail(405,'method_not_allowed');
   if(parts[0])return reply(await readConversation(env,a,parts[0]));
   const result=await listConversations(env,a);
   const {results:records=[]}=await env.DB.prepare('SELECT id recordId,order_number orderNumber FROM clinical_member_records WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').bind(actor.id).all();
   return reply({...result,records,memberId:actor.id});
  }
  const b=await readObject(request,6500);
  return reply(parts[1]?await markConversationRead(env,a,parts[0],b):await sendSecureMessage(env,a,parts[0]||null,b),201);
 }catch(e){return reply({error:e.status?e.message:'secure_messages_unavailable'},e.status||503);}
}
