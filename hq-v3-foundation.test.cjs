const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {boundedRead,validateMessages,counter,JOBS}=require('./hq-v3-foundation.js');
test('A stalled adapter times out even when it ignores AbortSignal',async()=>{
 const start=Date.now();await assert.rejects(boundedRead(()=>new Promise(()=>{}),'/test',{timeoutMs:15}),{name:'AbortError'});assert.ok(Date.now()-start<500);
});
test('Outbox invalid/missing stats remain Unavailable, and an empty queue requires a validated source',()=>{
 for(const stats of [null,{}, {sent:null},{sent:'0'},{sent:NaN},{sent:-1}])assert.equal(counter(stats,'sent'),'Unavailable');
 assert.equal(counter({sent:0},'sent'),'0');assert.deepEqual(validateMessages({messages:[]}),[]);
 for(const data of [{},{ok:false,messages:[]},{messages:[null]},{messages:[{id:1}]}])assert.throws(()=>validateMessages(data));
});
test('Outbox has its own table target; new assets are wired and legacy runtime remains untouched',()=>{
 const html=readFileSync(__dirname+'/index.html','utf8');assert.equal((html.match(/id="outboxRows"/g)||[]).length,1);assert.equal((html.match(/id="queueOutboxRows"/g)||[]).length,1);assert.match(html,/hq-v3-foundation.js/);assert.match(html,/hq-v3-foundation.css/);assert.match(readFileSync(__dirname+'/.assetsignore','utf8'),/!hq-v3-foundation.js/);
 assert.deepEqual(JOBS.map(x=>x[0]),['Overview','Operations','Money','Members','Comms','Growth','Publishing','Control']);
});
