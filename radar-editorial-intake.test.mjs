import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./hq.js',import.meta.url),'utf8');
const start=source.indexOf("$('#radarIntakeForm').onsubmit="),end=source.indexOf(";\n",start);
const handler=source.slice(start,end).split('.onsubmit=')[1];
function harness(fail=false){const calls=[],button={disabled:false},status={textContent:''},form={elements:{url:{value:'https://www.gov.uk/drug-safety-update/notice'},source_date:{value:'2026-10-26'},region:{value:'UK'}},querySelector:()=>button};const run=vm.runInNewContext('('+handler+')',{$:()=>status,JSON,String,Error,radarCall:async(path,options)=>{calls.push({path,options});if(fail)throw Error('source_fetch_failed');return {event:{id:1780},manualReviewRequired:true}},loadRadar:async id=>calls.push({load:id}),openRadarEvent:async id=>calls.push({open:id})});return{calls,button,status,run:()=>run({preventDefault(){},currentTarget:form})}}
test('source intake submits only the source date/URL/region and opens the returned exact item without approval or publication',async()=>{const h=harness();await h.run();assert.equal(h.calls[0].path,'/v1/hq/radar/intake');assert.deepEqual(JSON.parse(h.calls[0].options.body),{url:'https://www.gov.uk/drug-safety-update/notice',source_date:'2026-10-26',region:'UK'});assert.deepEqual(h.calls.slice(1),[{load:'1780'},{open:1780}]);assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/before approval and publication/);});
test('failed intake preserves a visible failure and never opens or publishes an item',async()=>{const h=harness(true);await h.run();assert.equal(h.calls.length,1);assert.match(h.status.textContent,/source_fetch_failed/);assert.equal(h.button.disabled,false)});
