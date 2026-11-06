import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapMemberInboxNavigation} from '../platform/member-entry.mjs';
const origin='https://shiftsometimber.co.uk';
const env={MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_MEMBER:{fetch:async r=>new Response('shared account '+new URL(r.url).pathname,{headers:{'Content-Type':'text/html'}})}};
test('an explicit app-settings destination preserves the existing response and request authority',async()=>{
 const ctx={scope:'synthetic'},html='<main id="existing-settings"><section id="healthConsentManager">Original consent controls</section></main>';let seen;
 const original={async fetch(r,e,c){seen={r,e,c};return new Response(html,{headers:{'Content-Type':'text/html','Cache-Control':'no-store, private','X-Original-Guard':'retained'}});}};
 const req=new Request(origin+'/member/settings?legacy-settings=1&view-data=1',{headers:{Cookie:'sst_session=synthetic-fixture-only','X-My-Timber-Expected-Account':'42'}}),res=await wrapMemberInboxNavigation(original).fetch(req,env,ctx);
 assert.equal(await res.text(),html);assert.equal(res.headers.get('X-Original-Guard'),'retained');assert.equal(res.headers.get('Cache-Control'),'no-store, private');assert.equal(seen.r,req);assert.equal(seen.e,env);assert.equal(seen.c,ctx);
});
test('ordinary More and the native loader internal marker still use the shared account service',async()=>{
 let fallback=0;const w=wrapMemberInboxNavigation({async fetch(){fallback++;return new Response('wrong legacy view');}});
 for(const suffix of ['', '?view-data=1','?legacy-settings=0&view-data=1']){const r=await w.fetch(new Request(origin+'/member/settings'+suffix),env,{});assert.equal(await r.text(),'shared account /member/my-shift');}assert.equal(fallback,0);
});
test('existing settings authentication failures pass through without becoming successful pages',async()=>{
 const w=wrapMemberInboxNavigation({async fetch(){return Response.json({error:'sign_in_required'},{status:401,headers:{'Cache-Control':'no-store, private'}});}}),r=await w.fetch(new Request(origin+'/member/settings?legacy-settings=1'),env,{});
 assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'sign_in_required'});assert.equal(r.headers.get('Cache-Control'),'no-store, private');
});

// The direct native settings document also needs the shared entry client, while
// retained-fragment responses already have their parent client.
test('direct original settings gets one shared client without changing controls',async()=>{
 const html='<!doctype html><html><head></head><body><input id="prefWeight"><div id="pwaReminderSettings"></div></body></html>';
 const original={fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html','ETag':'old'}})};
 const wrapped=wrapMemberInboxNavigation(original);const r=await wrapped.fetch(new Request('https://shiftsometimber.co.uk/member/settings?legacy-settings=1'),{MY_SHIFT_REDESIGN_ENABLED:'true'},{});const body=await r.text();assert.equal(body.replace('<script type="module" src="/assets/clinical-records/member-entry.mjs"></script>',''),html);assert.equal(r.headers.get('ETag'),null);
});
test('original retained settings keeps the exact existing response',async()=>{
 const response=new Response('<html><head></head><body data-mt-native-shell>Original controls</body></html>',{headers:{'Content-Type':'text/html'}});const wrapped=wrapMemberInboxNavigation({fetch:async()=>response});assert.equal(await wrapped.fetch(new Request('https://shiftsometimber.co.uk/member/settings?legacy-settings=1&view-data=1'),{MY_SHIFT_REDESIGN_ENABLED:'true'},{}),response);
});
