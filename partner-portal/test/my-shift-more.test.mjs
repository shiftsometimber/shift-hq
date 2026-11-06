import test from 'node:test';
import assert from 'node:assert/strict';
import {routeMyShiftExperience} from '../platform/my-shift-experience.mjs';
test('the original tools page is not replaced by a parallel member route',async()=>{
 const env={MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_MEMBER:{fetch:()=>{throw Error('Unexpected replacement');}}};
 for(const q of ['?timber=stuff','?timber=stuff&tools=1&view-data=1'])
  assert.equal(await routeMyShiftExperience(new Request('https://shiftsometimber.co.uk/member/dashboard'+q),env,{},{}),null);
});
