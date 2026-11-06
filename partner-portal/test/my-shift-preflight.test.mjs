import test from 'node:test';import assert from 'node:assert/strict';
import {withMyShiftPreflight} from '../my-shift-preflight.mjs';
const API='https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/my-shift-support';
const HQ='https://hq.shiftsometimber.co.uk';
function fixture(){const seen=[],response=new Response('Retained service authority',{status:405});const native={scheduled(){return 'retained'},fetch(...args){seen.push(args);return response;}};return{seen,response,worker:withMyShiftPreflight(native)};}
test('staged HQ support preflight exposes no records or session and accepts only existing HQ JSON methods',async()=>{
 const f=fixture();for(const path of [API,API+'/MS-900711108-00000000-0000-4000-8000-000000000040'])for(const method of ['GET','POST']){
 const r=await f.worker.fetch(new Request(path,{method:'OPTIONS',headers:{Origin:HQ,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'Content-Type'}}),{},{});
 assert.equal(r.status,204);assert.equal(await r.text(),'');assert.equal(r.headers.get('Access-Control-Allow-Origin'),HQ);assert.equal(r.headers.get('Access-Control-Allow-Credentials'),'true');assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Cache-Control'),'no-store, private');}
 assert.equal(f.seen.length,0);assert.equal(f.worker.scheduled(),'retained');
});
test('all actual reads, writes, unrelated URLs and invalid preflights preserve the exact original authority',async()=>{
 const f=fixture(),env={},ctx={};const inputs=[new Request(API),new Request(API,{method:'POST',headers:{Origin:HQ},body:'{}'}),new Request(API,{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'POST'}}),new Request(API,{method:'OPTIONS',headers:{Origin:HQ,'Access-Control-Request-Method':'DELETE'}}),new Request(API,{method:'OPTIONS',headers:{Origin:HQ,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Cloudflare-Workers-Version-Overrides'}}),new Request(API,{method:'OPTIONS',headers:{Origin:HQ}}),new Request(API+'/../different',{method:'OPTIONS',headers:{Origin:HQ,'Access-Control-Request-Method':'GET'}}),new Request(API.replace('api.','hq.'),{method:'OPTIONS',headers:{Origin:HQ,'Access-Control-Request-Method':'GET'}})];
 for(const request of inputs)assert.equal(await f.worker.fetch(request,env,ctx),f.response);
 assert.equal(f.seen.length,inputs.length);for(let i=0;i<inputs.length;i++)assert.deepEqual(f.seen[i],[inputs[i],env,ctx]);
});
