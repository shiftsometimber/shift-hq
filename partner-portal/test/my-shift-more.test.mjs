import test from 'node:test';
import assert from 'node:assert/strict';
import {routeMyShiftExperience} from '../platform/my-shift-experience.mjs';
test('More content uses the shared account view without a second account click',async()=>{
 const calls=[],env={MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_MEMBER:{fetch:async r=>{calls.push(r.url);return new Response('shared member view');}}};
 for(const [q,headers] of [['?timber=stuff&view-data=1',{}],['?timber=stuff',{'X-My-Timber-Content':'1'}]]){
  const r=await routeMyShiftExperience(new Request('https://shiftsometimber.co.uk/member/dashboard'+q,{headers}),env,{},{});assert.equal(await r.text(),'shared member view');
 }
 assert.deepEqual(calls,['https://shiftsometimber.co.uk/member/my-shift','https://shiftsometimber.co.uk/member/my-shift']);
});
test('More keeps the full app shell, other tabs, tools and foreign origins under their original owner',async()=>{
 const env={MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_MEMBER:{fetch:()=>{throw Error('Unexpected shared view');}}};
 for(const url of ['https://shiftsometimber.co.uk/member/dashboard?timber=stuff','https://shiftsometimber.co.uk/member/dashboard?timber=stuff&tools=1&view-data=1','https://shiftsometimber.co.uk/member/dashboard?timber=support&view-data=1','https://example.test/member/dashboard?timber=stuff&view-data=1'])
  assert.equal(await routeMyShiftExperience(new Request(url),env,{},{}),null);
});
